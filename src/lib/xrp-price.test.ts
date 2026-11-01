import { describe, expect, it } from "vitest";
import { priceFromCoinGecko } from "./xrp-price";

describe("priceFromCoinGecko", () => {
  it("maps the markets row", () => {
    expect(
      priceFromCoinGecko([
        {
          current_price: 2.5,
          price_change_percentage_24h: -1.2,
          market_cap: 140e9,
          total_volume: 3e9,
          high_24h: 2.6,
          low_24h: 2.4,
          circulating_supply: 56e9,
          total_supply: 99.9e9,
        },
      ]),
    ).toEqual({
      price: 2.5,
      change24h: -1.2,
      marketCap: 140e9,
      volume24h: 3e9,
      high24h: 2.6,
      low24h: 2.4,
      circulatingSupply: 56e9,
      totalSupply: 99.9e9,
    });
  });

  it("zeroes missing stats but needs a price", () => {
    expect(priceFromCoinGecko([{ current_price: 1, market_cap: null }])).toMatchObject({ price: 1, marketCap: 0 });
    expect(priceFromCoinGecko([{ current_price: null }])).toBeNull();
    expect(priceFromCoinGecko({ error: "rate limited" })).toBeNull();
    expect(priceFromCoinGecko([])).toBeNull();
  });
});
