//! XRP price from public market APIs, none of which needs a key.
//! Bitstamp gives the spot price; the aggregators (CoinGecko, then
//! CoinPaprika) give circulating supply and global 24h volume, and stand
//! in for Bitstamp when it fails.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const BITSTAMP_URL: &str = "https://www.bitstamp.net/api/v2/ticker/xrpusd/";
pub const COINGECKO_URL: &str =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ripple";
pub const COINPAPRIKA_URL: &str = "https://api.coinpaprika.com/v1/tickers/xrp-xrp";

/// How long a fetched price is reused.
pub const PRICE_TTL_MS: u64 = 5 * 60 * 1000;
/// Retry delay after every provider failed.
pub const PRICE_RETRY_MS: u64 = 30_000;
/// Supply data changes slowly.
pub const MARKET_TTL_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceData {
    pub price: f64,
    pub change24h: f64,
    pub market_cap: f64,
    pub volume24h: f64,
    pub high24h: f64,
    pub low24h: f64,
    pub circulating_supply: f64,
    pub total_supply: f64,
}

/// Bitstamp's ticker: one exchange's price and 24h range, no supply.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpotPrice {
    pub price: f64,
    pub change24h: f64,
    pub high24h: f64,
    pub low24h: f64,
}

/// Network-wide figures from an aggregator. Zero means unknown.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketData {
    pub circulating_supply: f64,
    pub total_supply: f64,
    pub volume24h: f64,
}

/// Before any aggregator has answered. The site shows "—", never a guess.
pub const UNKNOWN_MARKET: MarketData = MarketData {
    circulating_supply: 0.0,
    total_supply: 0.0,
    volume24h: 0.0,
};

/// JS `parseFloat(x) || 0`.
fn float_or_zero(value: Option<&Value>) -> f64 {
    let parsed = match value {
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        _ => f64::NAN,
    };
    if parsed.is_nan() { 0.0 } else { parsed }
}

/// A numeric JSON field, or 0 when it's missing or null.
fn number_or_zero(value: Option<&Value>) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(0.0)
}

/// A positive price, or None.
fn positive(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|p| *p > 0.0)
}

pub fn parse_bitstamp(body: &Value) -> Option<SpotPrice> {
    let price = float_or_zero(body.get("last"));
    if price == 0.0 || !price.is_finite() {
        return None;
    }
    Some(SpotPrice {
        price,
        change24h: float_or_zero(body.get("percent_change_24")),
        high24h: float_or_zero(body.get("high")),
        low24h: float_or_zero(body.get("low")),
    })
}

/// Bitstamp's price with the aggregators' supply and volume. Market cap
/// is derived, so it agrees with the price shown beside it.
pub fn combine(spot: SpotPrice, market: MarketData) -> PriceData {
    PriceData {
        price: spot.price,
        change24h: spot.change24h,
        market_cap: spot.price * market.circulating_supply,
        volume24h: market.volume24h,
        high24h: spot.high24h,
        low24h: spot.low24h,
        circulating_supply: market.circulating_supply,
        total_supply: market.total_supply,
    }
}

/// The network-wide figures in an aggregator's price, when it has a supply.
pub fn market_of(price: &PriceData) -> Option<MarketData> {
    (price.circulating_supply > 0.0).then_some(MarketData {
        circulating_supply: price.circulating_supply,
        total_supply: price.total_supply,
        volume24h: price.volume24h,
    })
}

/// CoinGecko's `/coins/markets`: an array with one row.
pub fn parse_coingecko(body: &Value) -> Option<PriceData> {
    let row = body.get(0)?;
    let field = |key: &str| number_or_zero(row.get(key));
    Some(PriceData {
        price: positive(row.get("current_price"))?,
        change24h: field("price_change_percentage_24h"),
        market_cap: field("market_cap"),
        volume24h: field("total_volume"),
        high24h: field("high_24h"),
        low24h: field("low_24h"),
        circulating_supply: field("circulating_supply"),
        total_supply: field("total_supply"),
    })
}

/// CoinPaprika's ticker. It has no 24h range and no circulating supply
/// field; its market cap is supply × price, so supply is cap ÷ price.
pub fn parse_coinpaprika(body: &Value) -> Option<PriceData> {
    let usd = body.get("quotes")?.get("USD")?;
    let field = |key: &str| number_or_zero(usd.get(key));
    let price = positive(usd.get("price"))?;
    let market_cap = field("market_cap");
    Some(PriceData {
        price,
        change24h: field("percent_change_24h"),
        market_cap,
        volume24h: field("volume_24h"),
        high24h: 0.0,
        low24h: 0.0,
        circulating_supply: market_cap / price,
        total_supply: number_or_zero(body.get("total_supply")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SPOT: SpotPrice = SpotPrice {
        price: 2.0,
        change24h: -1.0,
        high24h: 2.1,
        low24h: 1.9,
    };

    #[test]
    fn bitstamp_needs_a_price() {
        let body = json!({ "last": "2.50", "percent_change_24": "-1.2", "volume": "1000", "high": "2.6", "low": "2.4" });
        let spot = parse_bitstamp(&body).unwrap();
        assert_eq!((spot.price, spot.change24h, spot.high24h), (2.5, -1.2, 2.6));
        assert!(parse_bitstamp(&json!({ "last": "0" })).is_none());
        assert!(parse_bitstamp(&json!({ "last": "abc" })).is_none());
    }

    #[test]
    fn combine_derives_market_cap_from_supply() {
        let market = MarketData {
            circulating_supply: 63e9,
            total_supply: 99.98e9,
            volume24h: 3e9,
        };
        let price = combine(SPOT, market);
        assert_eq!(price.market_cap, 2.0 * 63e9);
        assert_eq!(price.volume24h, 3e9);
        assert_eq!(price.circulating_supply, 63e9);
    }

    #[test]
    fn unknown_market_shows_no_supply_cap_or_volume() {
        let price = combine(SPOT, UNKNOWN_MARKET);
        assert_eq!(price.price, 2.0);
        assert_eq!(
            (price.market_cap, price.circulating_supply, price.volume24h),
            (0.0, 0.0, 0.0)
        );
    }

    #[test]
    fn market_needs_a_supply() {
        let body = json!([{ "current_price": 1.25, "circulating_supply": 63.35e9, "total_supply": 99.98e9, "total_volume": 3.3e9 }]);
        let market = market_of(&parse_coingecko(&body).unwrap()).unwrap();
        assert_eq!(
            market,
            MarketData {
                circulating_supply: 63.35e9,
                total_supply: 99.98e9,
                volume24h: 3.3e9
            }
        );
        let no_supply = json!([{ "current_price": 1.25, "circulating_supply": null }]);
        assert!(market_of(&parse_coingecko(&no_supply).unwrap()).is_none());
    }

    #[test]
    fn coingecko_markets_shape() {
        let body = json!([{
            "current_price": 1.25, "market_cap": 79.09e9, "total_volume": 3.34e9,
            "high_24h": 1.31, "low_24h": 1.2, "price_change_percentage_24h": -3.2,
            "circulating_supply": 63.35e9, "total_supply": 99.98e9
        }]);
        let price = parse_coingecko(&body).unwrap();
        assert_eq!(
            (price.price, price.market_cap, price.change24h, price.low24h),
            (1.25, 79.09e9, -3.2, 1.2)
        );
        assert!(parse_coingecko(&json!([])).is_none());
        assert!(parse_coingecko(&json!([{ "current_price": 0 }])).is_none());
        assert!(parse_coingecko(&json!({ "status": { "error_code": 429 } })).is_none());
    }

    #[test]
    fn coinpaprika_supply_is_cap_over_price() {
        let body = json!({ "total_supply": 99.98e9, "quotes": { "USD": {
            "price": 1.25, "market_cap": 79.0e9, "volume_24h": 2.6e9, "percent_change_24h": -3.0
        } } });
        let price = parse_coinpaprika(&body).unwrap();
        assert_eq!(price.circulating_supply, 79.0e9 / 1.25);
        assert_eq!((price.volume24h, price.total_supply), (2.6e9, 99.98e9));
        assert_eq!(price.high24h, 0.0);
        assert!(parse_coinpaprika(&json!({ "error": "rate limited" })).is_none());
        assert!(parse_coinpaprika(&json!({ "quotes": { "USD": { "price": 0 } } })).is_none());
    }

    #[test]
    fn serializes_like_the_ts_price_type() {
        let wire = serde_json::to_value(combine(SPOT, UNKNOWN_MARKET)).unwrap();
        let mut keys: Vec<_> = wire.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "change24h",
                "circulatingSupply",
                "high24h",
                "low24h",
                "marketCap",
                "price",
                "totalSupply",
                "volume24h"
            ]
        );
    }
}
