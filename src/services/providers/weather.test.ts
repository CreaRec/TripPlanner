import { describe, expect, it, vi } from "vitest";
import { getWeather, resolveWeatherLocation } from "./weather";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveWeatherLocation", () => {
  it("uses explicit coordinates when provided", async () => {
    const location = await resolveWeatherLocation({
      location: "Zion NP",
      latitude: 37.3,
      longitude: -113.05,
      apiKey: "test-key",
    });
    expect(location).toEqual({
      label: "Zion NP",
      latitude: 37.3,
      longitude: -113.05,
    });
  });

  it("geocodes a place name via Google Places", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        places: [
          {
            id: "place-1",
            displayName: { text: "Paris" },
            formattedAddress: "Paris, France",
            location: { latitude: 48.8566, longitude: 2.3522 },
            types: ["locality"],
          },
        ],
      }),
    );

    const location = await resolveWeatherLocation({
      location: "Paris",
      apiKey: "test-key",
      fetchImpl,
    });

    expect(location.latitude).toBeCloseTo(48.8566);
    expect(location.longitude).toBeCloseTo(2.3522);
    expect(location.label).toContain("Paris");
  });
});

describe("getWeather", () => {
  it("returns current conditions and a daily forecast", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          currentTime: "2026-06-03T12:00:00Z",
          timeZone: { id: "America/Denver" },
          weatherCondition: { description: { text: "Sunny" }, type: "CLEAR" },
          temperature: { degrees: 24, unit: "CELSIUS" },
          feelsLikeTemperature: { degrees: 25, unit: "CELSIUS" },
          relativeHumidity: 30,
          uvIndex: 8,
          precipitation: { probability: { percent: 5, type: "RAIN" } },
          wind: {
            direction: { cardinal: "WEST", degrees: 270 },
            speed: { value: 12, unit: "KILOMETERS_PER_HOUR" },
            gust: { value: 20, unit: "KILOMETERS_PER_HOUR" },
          },
          isDaytime: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          timeZone: { id: "America/Denver" },
          forecastDays: [
            {
              displayDate: { year: 2026, month: 6, day: 3 },
              maxTemperature: { degrees: 28, unit: "CELSIUS" },
              minTemperature: { degrees: 14, unit: "CELSIUS" },
              daytimeForecast: {
                weatherCondition: { description: { text: "Mostly sunny" } },
                precipitation: { probability: { percent: 10, type: "RAIN" } },
              },
              nighttimeForecast: {
                precipitation: { probability: { percent: 20, type: "RAIN" } },
              },
            },
          ],
        }),
      );

    const weather = await getWeather({
      location: "Moab, UT",
      latitude: 38.57,
      longitude: -109.55,
      forecastDays: 1,
      apiKey: "test-key",
      fetchImpl,
    });

    expect(weather.current?.description).toBe("Sunny");
    expect(weather.current?.temperature).toBe("24°C");
    expect(weather.current?.wind).toContain("12 km/h");
    expect(weather.forecast_days).toHaveLength(1);
    expect(weather.forecast_days[0]).toMatchObject({
      date: "2026-06-03",
      description: "Mostly sunny",
      high: "28°C",
      low: "14°C",
      daytime_precipitation_chance_percent: 10,
      nighttime_precipitation_chance_percent: 20,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("currentConditions:lookup");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("forecast/days:lookup");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("days=1");
  });

  it("skips forecast lookup when forecast_days is 0", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        weatherCondition: { description: { text: "Cloudy" } },
        temperature: { degrees: 10, unit: "CELSIUS" },
      }),
    );

    const weather = await getWeather({
      location: "Reykjavik",
      latitude: 64.1466,
      longitude: -21.9426,
      forecastDays: 0,
      apiKey: "test-key",
      fetchImpl,
    });

    expect(weather.current?.description).toBe("Cloudy");
    expect(weather.forecast_days).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
