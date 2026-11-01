//! The Durable Object and the Worker entry point.
//!
//! The first visitor starts the node connection and the last one to leave
//! stops it, so the object only spends free-tier time while someone is
//! watching. While visitors are connected, a 30 s alarm acts as a watchdog:
//! it restarts a stalled connection, moves back to the primary node, and
//! rebuilds state after an eviction.

use std::{cell::RefCell, collections::HashMap, rc::Rc, time::Duration};

use futures_channel::oneshot;
use futures_util::{
    StreamExt,
    future::{self, Either},
};
use serde_json::{Value, json};
use worker::{
    AbortController, Context, Date, Delay, DurableObject, Env, Fetch, Headers, Request,
    RequestInit, Response, Result, State, Storage, Stub, Url, WebSocket, WebSocketIncomingMessage,
    WebSocketPair, console_log, console_warn, durable_object, event,
    wasm_bindgen_futures::spawn_local, ws_events::WebsocketEvent,
};

use crate::{
    ledger_queue::LedgerQueue,
    nodes::{self, NODES},
    price::{self, MarketData, PriceData},
    snapshot::{self, LedgerEvent, Responses},
};

/// Expanded ledgers are heavy (0.3–0.8 MB), so they get a longer timeout.
const LEDGER_TIMEOUT_MS: u64 = 25_000;
const REQUEST_TIMEOUT_MS: u64 = 8_000;
const CONNECT_TIMEOUT_MS: u64 = 10_000;
const BITSTAMP_TIMEOUT_MS: u64 = 5_000;
const PRICE_TIMEOUT_MS: u64 = 8_000;
/// `server_info` changes slowly, so one answer serves 15 s of ledger closes.
const SERVER_INFO_TTL_MS: u64 = 15_000;
const WATCHDOG_MS: i64 = 30_000;
/// Ledgers close every ~4 s, so this much silence means the socket is dead.
const STALE_UPSTREAM_MS: u64 = 20_000;
/// A connection that lived this long was healthy; reconnect to the same node.
const STABLE_MS: u64 = 10_000;
/// A node that failed fast is skipped for this long.
const FAILED_NODE_BENCH_MS: u64 = 10_000;
/// How long to stay on a fallback node before trying the primary again.
const PRIMARY_RETRY_MS: u64 = 10 * 60 * 1000;
const MARKET_KEY: &str = "market";
const USER_AGENT: &str = "sonde-relay (+https://sondelab.com)";

fn now() -> u64 {
    Date::now().as_millis()
}

enum RpcError {
    /// `slowDown` / `tooBusy`, with how long to bench the node.
    RateLimited(u64),
    /// Any other error code from the node.
    Node(String),
    Timeout,
    Closed,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimited(ms) => write!(f, "rate limited (retry in {ms} ms)"),
            Self::Node(code) => write!(f, "node error {code}"),
            Self::Timeout => f.write_str("timed out"),
            Self::Closed => f.write_str("connection closed"),
        }
    }
}

type RpcResult = std::result::Result<Value, RpcError>;

struct Upstream {
    ws: WebSocket,
    node: usize,
    connected_at: u64,
    next_id: u64,
    pending: HashMap<u64, oneshot::Sender<RpcResult>>,
}

#[derive(Default)]
struct Inner {
    /// Bumped whenever the upstream is replaced or stopped; tasks from an
    /// older session exit instead of acting on stale state.
    session: u64,
    connecting: bool,
    upstream: Option<Upstream>,
    benched_until: [u64; NODES.len()],
    reconnect_attempt: u32,
    last_message_at: u64,
    last_ledger: u64,
    /// Closes waiting on the snapshot builder, each with its session.
    ledgers: LedgerQueue<(u64, LedgerEvent)>,
    /// Last snapshot sent, for visitors who join between ledgers.
    latest: Option<String>,
    clients: Vec<WebSocket>,
    stored_loaded: bool,
    server_info: Option<(Value, u64)>,
    price: Option<PriceData>,
    price_at: u64,
    price_refreshing: bool,
    market: Option<(MarketData, u64)>,
}

type Shared = Rc<RefCell<Inner>>;
type SharedStorage = Rc<Storage>;

#[durable_object]
pub struct LiveRelay {
    state: State,
    storage: SharedStorage,
    inner: Shared,
}

impl DurableObject for LiveRelay {
    fn new(state: State, _env: Env) -> Self {
        let inner = Inner {
            // Visitor sockets survive an eviction; pick them back up.
            clients: state.get_websockets(),
            ..Inner::default()
        };
        let storage = Rc::new(state.storage());
        Self {
            state,
            storage,
            inner: Rc::new(RefCell::new(inner)),
        }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
        if req.path() == "/status" {
            return Response::from_json(&status(&self.inner.borrow()));
        }
        let pair = WebSocketPair::new()?;
        self.state.accept_web_socket(&pair.server);
        {
            let mut inner = self.inner.borrow_mut();
            if let Some(latest) = &inner.latest {
                let _ = pair.server.send_with_str(latest);
            }
            inner.clients.push(pair.server);
        }
        self.ensure_running().await?;
        Response::from_websocket(pair.client)
    }

    async fn alarm(&self) -> Result<Response> {
        let clients = self.state.get_websockets();
        let has_clients = !clients.is_empty();
        self.inner.borrow_mut().clients = clients;
        if !has_clients {
            stop(&self.inner);
            return Response::ok("idle");
        }
        let restart = needs_restart(&self.inner.borrow(), now());
        if restart {
            console_warn!("[relay] watchdog: restarting the node connection");
            drop_upstream(&self.inner, "watchdog restart");
        }
        self.ensure_running().await?;
        self.storage.set_alarm(WATCHDOG_MS).await?;
        Response::ok("ok")
    }

    // Visitors only listen.
    async fn websocket_message(
        &self,
        _ws: WebSocket,
        _message: WebSocketIncomingMessage,
    ) -> Result<()> {
        Ok(())
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _was_clean: bool,
    ) -> Result<()> {
        let _ = ws.close(Some(1000), Some("bye"));
        self.drop_client(&ws);
        Ok(())
    }

    async fn websocket_error(&self, ws: WebSocket, _error: worker::Error) -> Result<()> {
        self.drop_client(&ws);
        Ok(())
    }
}

impl LiveRelay {
    /// Starts the node connection if nothing is running, and arms the watchdog.
    async fn ensure_running(&self) -> Result<()> {
        let start = {
            let mut inner = self.inner.borrow_mut();
            let idle = inner.upstream.is_none() && !inner.connecting;
            if idle {
                inner.connecting = true;
            }
            idle
        };
        if start {
            self.load_stored().await;
            spawn_upstream(&self.inner, &self.storage);
            refresh_price_if_due(&self.inner, &self.storage);
        }
        if self.storage.get_alarm().await?.is_none() {
            self.storage.set_alarm(WATCHDOG_MS).await?;
        }
        Ok(())
    }

    /// Supply moves slowly, so the market figures are kept across restarts.
    async fn load_stored(&self) {
        if self.inner.borrow().stored_loaded {
            return;
        }
        let market: Option<(MarketData, u64)> =
            self.storage.get(MARKET_KEY).await.unwrap_or_default();
        let mut inner = self.inner.borrow_mut();
        inner.market = inner.market.or(market);
        inner.stored_loaded = true;
    }

    fn drop_client(&self, ws: &WebSocket) {
        let empty = {
            let mut inner = self.inner.borrow_mut();
            inner.clients.retain(|client| client != ws);
            inner.clients.is_empty()
        };
        if empty {
            stop(&self.inner);
        }
    }
}

fn needs_restart(inner: &Inner, now: u64) -> bool {
    let Some(upstream) = &inner.upstream else {
        return false;
    };
    let stalled = now.saturating_sub(inner.last_message_at) > STALE_UPSTREAM_MS;
    let primary_is_back = upstream.node != 0
        && inner.benched_until[0] <= now
        && now.saturating_sub(upstream.connected_at) > PRIMARY_RETRY_MS;
    stalled || primary_is_back
}

fn status(inner: &Inner) -> Value {
    let now = now();
    json!({
        "clients": inner.clients.len(),
        "node": inner.upstream.as_ref().map(|u| NODES[u.node]),
        "connecting": inner.connecting,
        "lastLedger": inner.last_ledger,
        "lastMessageAgeMs": inner.upstream.as_ref().map(|_| now.saturating_sub(inner.last_message_at)),
        "hasPrice": inner.price.is_some(),
        "benchedMs": inner.benched_until.iter().map(|until| until.saturating_sub(now)).collect::<Vec<_>>(),
    })
}

/// Closes the node connection and invalidates its tasks.
/// Returns whether anything was running.
fn drop_upstream(inner: &Shared, reason: &str) -> bool {
    let mut inner = inner.borrow_mut();
    let was_running = inner.upstream.is_some() || inner.connecting;
    inner.session += 1;
    inner.connecting = false;
    if let Some(upstream) = inner.upstream.take() {
        let _ = upstream.ws.close(Some(1000), Some(reason));
    }
    was_running
}

/// No visitors left: stop until the next one arrives.
fn stop(inner: &Shared) {
    if drop_upstream(inner, "no visitors") {
        console_log!("[relay] stopped: no visitors");
    }
    let mut inner = inner.borrow_mut();
    inner.latest = None;
    inner.reconnect_attempt = 0;
}

fn spawn_upstream(inner: &Shared, storage: &SharedStorage) {
    let session = {
        let mut inner = inner.borrow_mut();
        inner.session += 1;
        inner.connecting = true;
        inner.session
    };
    let (inner, storage) = (inner.clone(), storage.clone());
    spawn_local(run_upstream(inner, storage, session));
}

/// One node connection: connect, subscribe, read until it drops.
async fn run_upstream(inner: Shared, storage: SharedStorage, session: u64) {
    let Some(node) = wait_for_node(&inner, session).await else {
        return;
    };
    let ws = match connect(node).await {
        Ok(ws) => ws,
        Err(err) => {
            console_warn!("[relay] connect to {} failed: {err}", NODES[node]);
            upstream_lost(&inner, &storage, session, node, FAILED_NODE_BENCH_MS);
            return;
        }
    };
    // Listen before accepting so no message is missed.
    let Ok(mut events) = ws.events() else {
        upstream_lost(&inner, &storage, session, node, FAILED_NODE_BENCH_MS);
        return;
    };
    if ws.accept().is_err() {
        upstream_lost(&inner, &storage, session, node, FAILED_NODE_BENCH_MS);
        return;
    }
    let connected_at = now();
    {
        let mut state = inner.borrow_mut();
        if state.session != session {
            let _ = ws.close(Some(1000), Some("superseded"));
            return;
        }
        state.upstream = Some(Upstream {
            ws: ws.clone(),
            node,
            connected_at,
            next_id: 1,
            pending: HashMap::new(),
        });
        state.connecting = false;
        state.last_message_at = connected_at;
    }
    console_log!("[relay] connected to {}", NODES[node]);
    spawn_local(subscribe(inner.clone(), storage.clone(), session));

    while let Some(event) = events.next().await {
        if inner.borrow().session != session {
            return;
        }
        match event {
            Ok(WebsocketEvent::Message(message)) => {
                if let Some(text) = message.text() {
                    on_message(&inner, &storage, session, &text);
                }
            }
            Ok(WebsocketEvent::Close(_)) | Err(_) => break,
        }
    }
    let healthy = now().saturating_sub(connected_at) >= STABLE_MS;
    upstream_lost(
        &inner,
        &storage,
        session,
        node,
        if healthy { 0 } else { FAILED_NODE_BENCH_MS },
    );
}

/// The first node that isn't benched, waiting out benches if needed.
async fn wait_for_node(inner: &Shared, session: u64) -> Option<usize> {
    loop {
        let picked = {
            let inner = inner.borrow();
            if inner.session != session {
                return None;
            }
            nodes::pick_node(&inner.benched_until, now())
        };
        match picked {
            Ok(node) => return Some(node),
            Err(wait_ms) => Delay::from(Duration::from_millis(wait_ms.max(100))).await,
        }
    }
}

async fn connect(node: usize) -> Result<WebSocket> {
    let url: Url = NODES[node].parse()?;
    let connecting = Box::pin(WebSocket::connect(url));
    let timeout = Box::pin(Delay::from(Duration::from_millis(CONNECT_TIMEOUT_MS)));
    match future::select(connecting, timeout).await {
        Either::Left((result, _)) => result,
        Either::Right(_) => Err(worker::Error::RustError("connect timed out".into())),
    }
}

/// The connection dropped or failed: bench the node if it failed fast, then
/// reconnect with backoff while visitors remain.
fn upstream_lost(
    inner: &Shared,
    storage: &SharedStorage,
    session: u64,
    node: usize,
    bench_ms: u64,
) {
    let (retry_session, delay_ms) = {
        let mut state = inner.borrow_mut();
        if state.session != session {
            return;
        }
        state.session += 1;
        if let Some(upstream) = state.upstream.take() {
            let _ = upstream.ws.close(Some(1000), Some("reconnecting"));
        }
        if bench_ms > 0 {
            state.benched_until[node] = state.benched_until[node].max(now() + bench_ms);
        }
        if state.clients.is_empty() {
            state.connecting = false;
            return;
        }
        state.connecting = true;
        let attempt = state.reconnect_attempt;
        state.reconnect_attempt = attempt.saturating_add(1);
        (state.session, nodes::reconnect_delay_ms(attempt))
    };
    console_warn!(
        "[relay] lost {}; reconnecting in {delay_ms} ms",
        NODES[node]
    );
    let (inner, storage) = (inner.clone(), storage.clone());
    spawn_local(async move {
        Delay::from(Duration::from_millis(delay_ms)).await;
        if inner.borrow().session == retry_session {
            spawn_upstream(&inner, &storage);
        }
    });
}

/// A rate-limited node gets benched for its hint and we move to the next one.
fn switch_node(inner: &Shared, storage: &SharedStorage, session: u64, bench_ms: u64) {
    let node = inner.borrow().upstream.as_ref().map(|u| u.node);
    if let Some(node) = node {
        console_warn!(
            "[relay] {} rate-limited us; benching {bench_ms} ms",
            NODES[node]
        );
        upstream_lost(inner, storage, session, node, bench_ms);
    }
}

async fn subscribe(inner: Shared, storage: SharedStorage, session: u64) {
    let command = json!({ "command": "subscribe", "streams": ["ledger"] });
    if let Err(err) = request(&inner, command, REQUEST_TIMEOUT_MS).await {
        console_warn!("[relay] subscribe failed: {err}");
        let bench_ms = match err {
            RpcError::RateLimited(ms) => ms,
            _ => FAILED_NODE_BENCH_MS,
        };
        switch_node(&inner, &storage, session, bench_ms);
    }
}

/// Sends a command on the current connection and waits for its reply.
async fn request(inner: &Shared, mut command: Value, timeout_ms: u64) -> RpcResult {
    let (sender, receiver) = oneshot::channel();
    let id = {
        let mut state = inner.borrow_mut();
        let Some(upstream) = state.upstream.as_mut() else {
            return Err(RpcError::Closed);
        };
        let id = upstream.next_id;
        upstream.next_id += 1;
        command["id"] = json!(id);
        if upstream.ws.send_with_str(command.to_string()).is_err() {
            return Err(RpcError::Closed);
        }
        upstream.pending.insert(id, sender);
        id
    };
    let timeout = Box::pin(Delay::from(Duration::from_millis(timeout_ms)));
    match future::select(receiver, timeout).await {
        Either::Left((Ok(outcome), _)) => outcome,
        Either::Left((Err(_canceled), _)) => Err(RpcError::Closed),
        Either::Right(_) => {
            if let Some(upstream) = inner.borrow_mut().upstream.as_mut() {
                upstream.pending.remove(&id);
            }
            Err(RpcError::Timeout)
        }
    }
}

fn rpc_outcome(message: &mut Value) -> RpcResult {
    let failed = message.get("status").and_then(Value::as_str) == Some("error");
    match message.get("error").and_then(Value::as_str) {
        Some(code) if nodes::is_rate_limit(code) => {
            let hint = message
                .get("error_message")
                .and_then(Value::as_str)
                .unwrap_or_default();
            Err(RpcError::RateLimited(nodes::rate_limit_cooldown_ms(hint)))
        }
        Some(code) => Err(RpcError::Node(code.to_owned())),
        None if failed => Err(RpcError::Node("error".to_owned())),
        None => Ok(message
            .get_mut("result")
            .map(Value::take)
            .unwrap_or(Value::Null)),
    }
}

fn on_message(inner: &Shared, storage: &SharedStorage, session: u64, text: &str) {
    let Ok(mut message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let reply_to = {
        let mut state = inner.borrow_mut();
        if state.session != session || state.upstream.is_none() {
            return;
        }
        state.last_message_at = now();
        let id = message.get("id").and_then(Value::as_u64);
        id.and_then(|id| state.upstream.as_mut()?.pending.remove(&id))
    };
    if let Some(sender) = reply_to {
        let _ = sender.send(rpc_outcome(&mut message));
        return;
    }
    if message.get("type").and_then(Value::as_str) != Some("ledgerClosed") {
        return;
    }
    if let Some(event) = snapshot::parse_ledger_event(&message) {
        let start = {
            let mut state = inner.borrow_mut();
            state.last_ledger = event.ledger_index;
            state.ledgers.offer((session, event))
        };
        if let Some(close) = start {
            spawn_local(process_ledgers(inner.clone(), storage.clone(), close));
        }
    }
}

/// Builds and broadcasts the snapshot for one ledger close, then for the
/// close that landed meanwhile, if any.
async fn process_ledgers(inner: Shared, storage: SharedStorage, mut close: (u64, LedgerEvent)) {
    loop {
        let (session, event) = close;
        let snapshot = build_snapshot(&inner, &storage, session, &event).await;
        let mut state = inner.borrow_mut();
        if let Some(text) = snapshot.filter(|_| state.session == session) {
            state.reconnect_attempt = 0;
            state.clients.retain(|ws| ws.send_with_str(&text).is_ok());
            state.latest = Some(text);
        }
        close = loop {
            match state.ledgers.finish() {
                Some(next) if next.0 == state.session => break next,
                // From a replaced upstream: its snapshot would be dropped.
                Some(_) => continue,
                None => return,
            }
        };
    }
}

async fn build_snapshot(
    inner: &Shared,
    storage: &SharedStorage,
    session: u64,
    event: &LedgerEvent,
) -> Option<String> {
    let ledger_command = json!({
        "command": "ledger",
        "ledger_index": event.ledger_index,
        "transactions": true,
        "expand": true,
    });
    let (ledger, server_info) = futures_util::join!(
        request(inner, ledger_command, LEDGER_TIMEOUT_MS),
        server_info(inner, storage, session),
    );
    let ledger = settle(inner, storage, session, "ledger", ledger);

    let digest = ledger.as_ref().and_then(snapshot::digest_ledger);
    refresh_price_if_due(inner, storage);
    let price = inner.borrow().price;

    let responses = Responses {
        ledger: ledger.as_ref(),
        server_info: server_info.as_ref(),
    };
    let snapshot = snapshot::build_snapshot(event, digest.as_ref(), responses, price);
    serde_json::to_string(&snapshot).ok()
}

/// Keeps a successful reply; logs a failure and switches nodes on a rate limit.
fn settle(
    inner: &Shared,
    storage: &SharedStorage,
    session: u64,
    label: &str,
    result: RpcResult,
) -> Option<Value> {
    match result {
        Ok(value) => Some(value),
        Err(err) => {
            console_warn!("[relay] {label} failed: {err}");
            if let RpcError::RateLimited(bench_ms) = err {
                switch_node(inner, storage, session, bench_ms);
            }
            None
        }
    }
}

async fn server_info(inner: &Shared, storage: &SharedStorage, session: u64) -> Option<Value> {
    let cached = inner
        .borrow()
        .server_info
        .as_ref()
        .filter(|(_, at)| now().saturating_sub(*at) < SERVER_INFO_TTL_MS)
        .map(|(value, _)| value.clone());
    if cached.is_some() {
        return cached;
    }
    let result = request(
        inner,
        json!({ "command": "server_info" }),
        REQUEST_TIMEOUT_MS,
    )
    .await;
    let value = settle(inner, storage, session, "server_info", result)?;
    inner.borrow_mut().server_info = Some((value.clone(), now()));
    Some(value)
}

fn refresh_price_if_due(inner: &Shared, storage: &SharedStorage) {
    {
        let mut state = inner.borrow_mut();
        if state.price_refreshing || now().saturating_sub(state.price_at) < price::PRICE_TTL_MS {
            return;
        }
        state.price_refreshing = true;
    }
    let (inner, storage) = (inner.clone(), storage.clone());
    spawn_local(async move {
        let fetched = fetch_price(&inner, &storage).await;
        let mut state = inner.borrow_mut();
        state.price_refreshing = false;
        match fetched {
            Some(price) => {
                state.price = Some(price);
                state.price_at = now();
            }
            // Keep the stale price and try again soon.
            None => {
                state.price_at = now().saturating_sub(price::PRICE_TTL_MS - price::PRICE_RETRY_MS)
            }
        }
    });
}

/// Bitstamp's price with the aggregators' supply and volume (refreshed
/// every 10 min), or an aggregator's own price when Bitstamp fails.
async fn fetch_price(inner: &Shared, storage: &SharedStorage) -> Option<PriceData> {
    let cached = inner.borrow().market;
    let market_due = cached.is_none_or(|(_, at)| now().saturating_sub(at) >= price::MARKET_TTL_MS);
    let (spot, quoted) = futures_util::join!(
        fetch_json(price::BITSTAMP_URL, BITSTAMP_TIMEOUT_MS),
        async {
            if market_due {
                fetch_aggregate().await
            } else {
                None
            }
        },
    );
    let market = match quoted.as_ref().and_then(price::market_of) {
        Some(market) => {
            save_market(inner, storage, market);
            market
        }
        // Old figures beat none: supply moves about 1% a month.
        None => cached.map_or(price::UNKNOWN_MARKET, |(market, _)| market),
    };
    if let Some(spot) = spot.as_ref().and_then(price::parse_bitstamp) {
        return Some(price::combine(spot, market));
    }
    console_warn!("[relay] Bitstamp price failed, falling back to the aggregators");
    // Use this round's answer; ask again only if nobody was asked.
    if market_due {
        quoted
    } else {
        fetch_aggregate().await
    }
}

/// CoinGecko, then CoinPaprika: a full price with supply and global volume.
async fn fetch_aggregate() -> Option<PriceData> {
    if let Some(price) = fetch_json(price::COINGECKO_URL, PRICE_TIMEOUT_MS)
        .await
        .as_ref()
        .and_then(price::parse_coingecko)
    {
        return Some(price);
    }
    console_warn!("[relay] CoinGecko failed, trying CoinPaprika");
    let price = fetch_json(price::COINPAPRIKA_URL, PRICE_TIMEOUT_MS)
        .await
        .as_ref()
        .and_then(price::parse_coinpaprika);
    if price.is_none() {
        console_warn!("[relay] every market API failed");
    }
    price
}

fn save_market(inner: &Shared, storage: &SharedStorage, market: MarketData) {
    let entry = (market, now());
    inner.borrow_mut().market = Some(entry);
    let storage = storage.clone();
    spawn_local(async move {
        if let Err(err) = storage.put(MARKET_KEY, entry).await {
            console_warn!("[relay] saving market data failed: {err}");
        }
    });
}

/// A JSON body, or None on a network error, timeout or non-2xx status.
async fn fetch_json(url: &str, timeout_ms: u64) -> Option<Value> {
    let request = json_request(url).ok()?;
    let controller = AbortController::default();
    let signal = controller.signal();
    let sending = Box::pin(async move {
        let mut response = Fetch::Request(request).send_with_signal(&signal).await?;
        if !(200..300).contains(&response.status_code()) {
            return Ok(None);
        }
        Ok::<_, worker::Error>(Some(response.json::<Value>().await?))
    });
    let timeout = Box::pin(Delay::from(Duration::from_millis(timeout_ms)));
    match future::select(sending, timeout).await {
        Either::Left((fetched, _)) => fetched.ok().flatten(),
        Either::Right(_) => {
            controller.abort();
            None
        }
    }
}

fn json_request(url: &str) -> Result<Request> {
    let headers = Headers::new();
    headers.set("User-Agent", USER_AGENT)?;
    headers.set("Accept", "application/json")?;
    let mut init = RequestInit::new();
    init.with_headers(headers);
    Request::new_with_init(url, &init)
}

/// `/live` upgrades to the relay's WebSocket for allowed origins; `/status`
/// reports the relay's health.
#[event(fetch)]
async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    match req.path().as_str() {
        "/live" => {
            let upgrade = req.headers().get("Upgrade")?;
            if !upgrade.is_some_and(|u| u.eq_ignore_ascii_case("websocket")) {
                return Response::error("Expected a WebSocket upgrade", 426);
            }
            if !origin_allowed(&req, &env)? {
                return Response::error("Origin not allowed", 403);
            }
            relay_stub(&env)?.fetch_with_request(req).await
        }
        "/status" => relay_stub(&env)?.fetch_with_request(req).await,
        _ => Response::error("Not found", 404),
    }
}

/// One relay for the whole site.
fn relay_stub(env: &Env) -> Result<Stub> {
    let namespace = env.durable_object("LIVE_RELAY")?;
    let id = namespace.id_from_name("mainnet")?;
    id.get_stub()
}

/// Only our own pages may use the relay, so others can't spend its free quota.
fn origin_allowed(req: &Request, env: &Env) -> Result<bool> {
    let Some(origin) = req.headers().get("Origin")? else {
        return Ok(false);
    };
    let allowed = env.var("ALLOWED_ORIGINS")?.to_string();
    Ok(allowed.split(',').map(str::trim).any(|o| o == origin))
}
