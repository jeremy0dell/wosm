import type { TuiConfig, TuiWidgetConfig } from "@wosm/config";

export type { TuiConfig, TuiWidgetConfig };

export type TopRowWidgetView = {
  id: string;
  text: string;
};

export type TimeWidgetRuntime = {
  now?: () => Date;
};

export type WeatherCurrentConditions = {
  temperature: number;
  weatherCode: number;
  isDay: boolean;
};

export type WeatherTemperatureUnit = "fahrenheit" | "celsius";

export type WeatherClient = {
  getCurrentWeather(
    city: string,
    temperatureUnit: WeatherTemperatureUnit,
  ): Promise<WeatherCurrentConditions>;
};

export type TopRowWidgetRuntimeDeps = TimeWidgetRuntime & {
  weatherClient?: WeatherClient;
};
