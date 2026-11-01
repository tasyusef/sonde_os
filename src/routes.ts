import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("support", "routes/support.tsx"),
    route("network", "routes/network.tsx"),
    route("watchlist", "routes/watchlist.tsx"),
    route("tx/:hash", "routes/tx.tsx"),
    route("ledger/:index", "routes/ledger.tsx"),
    route("nft/:id", "routes/nft.tsx"),
    route("account/:address", "routes/account.tsx"),
    route("token/:id", "routes/token.tsx"),
    route("search/:query", "routes/search.tsx"),
    layout("routes/docs/layout.tsx", [
      ...prefix("docs", [
        index("routes/docs/index.tsx"),
        route("introduction", "routes/docs/introduction.tsx"),
        route("searching", "routes/docs/searching.tsx"),
        route("accounts", "routes/docs/accounts.tsx"),
        route("transactions", "routes/docs/transactions.tsx"),
        route("nfts", "routes/docs/nfts.tsx"),
        route("what-is-xrpl", "routes/docs/what-is-xrpl.tsx"),
        route("accounts-and-keys", "routes/docs/accounts-and-keys.tsx"),
        route("transaction-types", "routes/docs/transaction-types.tsx"),
      ]),
    ]),
    route("*", "routes/not-found.tsx"),
  ]),
  // Outside the app shell: no sidebar, top bar or XRPL connection.
  route("designsystem", "routes/designsystem.tsx"),
] satisfies RouteConfig;
