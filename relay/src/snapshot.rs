//! Builds the per-ledger live snapshot from raw XRPL responses.
//!
//! Its output matches `src/types/live-data.ts` field for field, so the site's
//! components render it unchanged. Fields copied straight from node responses
//! (strings on some nodes, numbers on others) stay raw JSON values.

use serde::Serialize;
use serde_json::{Value, json};

use crate::price::PriceData;

/// Per-tx summary for the ledger dot grids.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TxSummary {
    pub hash: String,
    #[serde(rename = "type")]
    pub tx_type: String,
    pub result: String,
}

/// A `ledgerClosed` stream event, enriched with that ledger's tx summaries.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LedgerEvent {
    pub ledger_index: u64,
    pub ledger_hash: String,
    pub ledger_time: u64,
    pub txn_count: u64,
    #[serde(rename = "txSummaries", skip_serializing_if = "Option::is_none")]
    pub tx_summaries: Option<Vec<TxSummary>>,
    /// Total fees burned in the ledger, in drops.
    #[serde(rename = "totalFees", skip_serializing_if = "Option::is_none")]
    pub total_fees: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    pub ledger_index: Value,
    pub tx_count: Value,
    pub close_time: Value,
    pub total_coins: Value,
    pub base_fee: String,
    pub reserve_base: Value,
    pub reserve_increment: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHealth {
    pub build_version: String,
    pub load_factor: Value,
    pub server_state: Value,
    pub quorum: Value,
    pub complete_ledgers: Value,
    pub validated_seq: Value,
}

/// The transaction list the site no longer shows, always sent empty: sites
/// built before 9724a5ce read `transactions.txs` unguarded and crash without
/// it. Remove once no tab of such a site can still be open.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LegacyTransactions {
    pub txs: [(); 0],
    pub total: u64,
}

/// One message to every visitor per ledger close. `health` and `price` are
/// left out when unknown so the client keeps its previous value.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub ledger: LedgerEvent,
    pub transactions: LegacyTransactions,
    pub stats: NetworkStats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<ServerHealth>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<PriceData>,
}

/// What one expanded ledger yields.
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerDigest {
    pub summaries: Vec<TxSummary>,
    pub total_fees: String,
}

/// JS `a ?? b` for JSON: null and missing both fall through.
fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

fn or_value(value: Option<&Value>, default: Value) -> Value {
    present(value).cloned().unwrap_or(default)
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// JS `Number(x ?? 0)` for the integer fields of a stream event.
fn number(value: Option<&Value>) -> u64 {
    match present(value) {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

/// JS truthiness of a JSON value.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JS `String(n)` for a JSON number (Rust's shortest round-trip formatting
/// matches JS for every value a fee can take).
fn js_number_string(value: &Value) -> String {
    match value {
        Value::Number(n) if n.is_f64() => n.as_f64().map(|f| f.to_string()).unwrap_or_default(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// `tx.meta?.TransactionResult ?? tx.metaData?.TransactionResult ?? ""`.
fn tx_result(tx: &Value) -> String {
    ["meta", "metaData"]
        .iter()
        .find_map(|key| present(tx.get(*key)).and_then(|m| present(m.get("TransactionResult"))))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// `BigInt(tx.Fee ?? "0")`, skipping fees that don't parse.
fn tx_fee_drops(tx: &Value) -> Option<u128> {
    match present(tx.get("Fee")) {
        None => Some(0),
        Some(Value::String(s)) if s.trim().is_empty() => Some(0),
        Some(Value::String(s)) => s.trim().parse().ok(),
        Some(Value::Number(n)) => n.as_u64().map(u128::from),
        Some(_) => None,
    }
}

/// Parses a `ledgerClosed` stream message. Events without a ledger index are
/// rejected.
pub fn parse_ledger_event(message: &Value) -> Option<LedgerEvent> {
    let ledger_index = number(message.get("ledger_index"));
    if ledger_index == 0 {
        return None;
    }
    Some(LedgerEvent {
        ledger_index,
        ledger_hash: string_field(message, "ledger_hash"),
        ledger_time: number(message.get("ledger_time")),
        txn_count: number(message.get("txn_count")),
        tx_summaries: None,
        total_fees: None,
    })
}

/// Digests an expanded `ledger` result (`transactions: true, expand: true`).
pub fn digest_ledger(result: &Value) -> Option<LedgerDigest> {
    let ledger = present(result.get("ledger"))?;
    let txs: &[Value] = ledger
        .get("transactions")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice);

    let mut fee_sum: u128 = 0;
    let summaries = txs
        .iter()
        .map(|tx| {
            if let Some(fee) = tx_fee_drops(tx) {
                fee_sum += fee;
            }
            TxSummary {
                hash: string_field(tx, "hash"),
                tx_type: string_field(tx, "TransactionType"),
                result: tx_result(tx),
            }
        })
        .collect();

    Some(LedgerDigest {
        summaries,
        total_fees: fee_sum.to_string(),
    })
}

/// Network stats from a `ledger` result and a `server_info` result.
pub fn network_stats(ledger_result: &Value, server_info_result: &Value) -> Option<NetworkStats> {
    let ledger = present(ledger_result.get("ledger"))?;
    let validated = present(server_info_result.get("info"))?.get("validated_ledger");
    let validated = present(validated);
    let field = |key: &str| validated.and_then(|v| present(v.get(key)));

    Some(NetworkStats {
        ledger_index: or_value(ledger.get("ledger_index"), Value::Null),
        tx_count: json!(
            ledger
                .get("transactions")
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
        ),
        close_time: or_value(ledger.get("close_time"), Value::Null),
        total_coins: or_value(ledger.get("total_coins"), Value::Null),
        base_fee: field("base_fee_xrp").map_or_else(|| "0.000012".to_owned(), js_number_string),
        // Defaults reflect current XRPL mainnet (post-ReserveCut amendment).
        reserve_base: field("reserve_base_xrp").cloned().unwrap_or(json!(1)),
        reserve_increment: field("reserve_inc_xrp").cloned().unwrap_or(json!(0.2)),
    })
}

/// Stats built from the stream event alone, for when the node calls fail.
pub fn fallback_stats(event: &LedgerEvent) -> NetworkStats {
    NetworkStats {
        ledger_index: json!(event.ledger_index),
        tx_count: json!(event.txn_count),
        close_time: json!(event.ledger_time),
        total_coins: json!("0"),
        base_fee: "0.000012".to_owned(),
        reserve_base: json!(1),
        reserve_increment: json!(0.2),
    }
}

pub fn server_health(server_info_result: &Value) -> Option<ServerHealth> {
    let info = present(server_info_result.get("info"))?;
    let build_version = match present(info.get("build_version")) {
        Some(version) => js_number_string(version),
        None if truthy(info.get("clio_version")) => {
            format!("Clio {}", js_number_string(&info["clio_version"]))
        }
        None => "unknown".to_owned(),
    };
    let server_state = match present(info.get("server_state")) {
        Some(state) => state.clone(),
        None if truthy(info.get("validated_ledger")) => json!("validated"),
        None => json!("unknown"),
    };
    Some(ServerHealth {
        build_version,
        load_factor: or_value(info.get("load_factor"), json!(1)),
        server_state,
        quorum: or_value(info.get("validation_quorum"), json!(0)),
        complete_ledgers: or_value(info.get("complete_ledgers"), json!("—")),
        validated_seq: or_value(
            info.get("validated_ledger").and_then(|v| v.get("seq")),
            json!(0),
        ),
    })
}

/// Node responses gathered for one ledger close. Either may be missing.
#[derive(Debug, Default, Clone, Copy)]
pub struct Responses<'a> {
    pub ledger: Option<&'a Value>,
    pub server_info: Option<&'a Value>,
}

/// Assembles the snapshot for one ledger close. Missing node responses
/// degrade the matching fields, never the whole snapshot.
pub fn build_snapshot(
    event: &LedgerEvent,
    digest: Option<&LedgerDigest>,
    responses: Responses<'_>,
    price: Option<PriceData>,
) -> Snapshot {
    let stats = responses
        .ledger
        .zip(responses.server_info)
        .and_then(|(ledger, info)| network_stats(ledger, info))
        .unwrap_or_else(|| fallback_stats(event));

    let mut ledger = event.clone();
    if let Some(digest) = digest {
        ledger.tx_summaries = Some(digest.summaries.clone());
        ledger.total_fees = Some(digest.total_fees.clone());
    }

    Snapshot {
        ledger,
        transactions: LegacyTransactions {
            txs: [],
            total: event.txn_count,
        },
        stats,
        health: responses.server_info.and_then(server_health),
        price,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        serde_json::from_str(&text).unwrap()
    }

    fn result(name: &str) -> Value {
        fixture(name)["result"].clone()
    }

    /// JSON as a browser sees it: Clio writes `1E0` where JS writes `1`, and
    /// both parse to the same number.
    fn as_js(value: Value) -> Value {
        match value {
            Value::Number(n) => json!(n.as_f64()),
            Value::Array(items) => Value::Array(items.into_iter().map(as_js).collect()),
            Value::Object(map) => {
                Value::Object(map.into_iter().map(|(k, v)| (k, as_js(v))).collect())
            }
            other => other,
        }
    }

    fn assert_wire_eq(actual: impl Serialize, expected: &Value) {
        assert_eq!(
            as_js(serde_json::to_value(actual).unwrap()),
            as_js(expected.clone())
        );
    }

    /// expected.json was computed from the fixtures with the exact TS
    /// expressions of src/lib/xrpl-data.ts (deleted in 4cf99567).
    #[test]
    fn matches_typescript_output() {
        let expected = fixture("expected.json");
        let ledger = result("ledger.json");
        let info = result("server_info.json");

        let digest = digest_ledger(&ledger).unwrap();
        assert_wire_eq(&digest.summaries, &expected["txSummaries"]);
        assert_wire_eq(&digest.total_fees, &expected["totalFees"]);
        assert_wire_eq(network_stats(&ledger, &info).unwrap(), &expected["stats"]);
        assert_wire_eq(server_health(&info).unwrap(), &expected["health"]);
    }

    #[test]
    fn parses_ledger_closed_events() {
        let message = json!({
            "type": "ledgerClosed", "ledger_index": 107885643, "ledger_hash": "AB",
            "ledger_time": 846216840, "txn_count": 156, "fee_base": 10
        });
        let event = parse_ledger_event(&message).unwrap();
        assert_eq!(event.ledger_index, 107885643);
        assert_eq!(event.txn_count, 156);
        assert_eq!(event.ledger_hash, "AB");
        assert!(parse_ledger_event(&json!({ "type": "ledgerClosed" })).is_none());
    }

    #[test]
    fn snapshot_degrades_when_node_calls_fail() {
        let event =
            parse_ledger_event(&json!({ "ledger_index": 5, "ledger_time": 9, "txn_count": 3 }))
                .unwrap();
        let snapshot = build_snapshot(&event, None, Responses::default(), None);
        let wire = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(wire["transactions"], json!({ "txs": [], "total": 3 }));
        assert_eq!(wire["stats"]["totalCoins"], json!("0"));
        assert_eq!(wire["stats"]["ledgerIndex"], json!(5));
        assert!(wire.get("health").is_none() && wire.get("price").is_none());
        assert!(wire["ledger"].get("txSummaries").is_none());
    }

    #[test]
    fn snapshot_attaches_ledger_summaries() {
        let ledger = result("ledger.json");
        let digest = digest_ledger(&ledger).unwrap();
        let event =
            parse_ledger_event(&json!({ "ledger_index": 107885643, "txn_count": 18 })).unwrap();
        let responses = Responses {
            ledger: Some(&ledger),
            ..Responses::default()
        };
        let wire =
            serde_json::to_value(build_snapshot(&event, Some(&digest), responses, None)).unwrap();
        assert_eq!(wire["ledger"]["txSummaries"].as_array().unwrap().len(), 18);
        assert_eq!(wire["ledger"]["totalFees"], json!("5246"));
        // Old sites crash without this, even empty.
        assert_eq!(wire["transactions"], json!({ "txs": [], "total": 18 }));
        // server_info missing: stats fall back to the event, like the TS manager.
        assert_eq!(wire["stats"]["totalCoins"], json!("0"));
    }

    #[test]
    fn health_handles_clio_and_rippled() {
        let clio = json!({ "info": { "clio_version": "2.8.0", "validated_ledger": { "seq": 7 } } });
        let health = server_health(&clio).unwrap();
        assert_eq!(health.build_version, "Clio 2.8.0");
        assert_eq!(health.server_state, json!("validated"));
        assert_eq!(health.complete_ledgers, json!("—"));

        let rippled = json!({ "info": { "build_version": "3.4.1", "server_state": "full" } });
        let health = server_health(&rippled).unwrap();
        assert_eq!(health.build_version, "3.4.1");
        assert_eq!(health.server_state, json!("full"));
        assert_eq!(health.validated_seq, json!(0));
    }

    #[test]
    fn fee_sum_skips_unparseable_fees() {
        let ledger = json!({ "ledger": { "transactions": [
            { "Fee": "12" }, { "Fee": "not-a-number" }, { "Fee": "" }, {}, { "Fee": "30" }
        ] } });
        assert_eq!(digest_ledger(&ledger).unwrap().total_fees, "42");
    }
}
