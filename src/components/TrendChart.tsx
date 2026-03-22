import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FoodEntryWithNutrients, NutrientCode } from "../lib/types";

interface TrendChartProps {
  entries: FoodEntryWithNutrients[];
  metricCode: NutrientCode;
  metricLabel: string;
}

const getMetricAmount = (entry: FoodEntryWithNutrients, metricCode: NutrientCode): number => {
  const found = entry.food_entry_nutrients?.find((nutrient) => nutrient.nutrient_code === metricCode);
  if (!found) {
    return 0;
  }
  return Number(found.amount || 0);
};

const toDayKey = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
};

export const TrendChart = ({ entries, metricCode, metricLabel }: TrendChartProps) => {
  const points = entries
    .reduce<Record<string, number>>((acc, entry) => {
      const dateKey = toDayKey(entry.consumed_at);
      acc[dateKey] = (acc[dateKey] ?? 0) + getMetricAmount(entry, metricCode);
      return acc;
    }, {});

  const chartData = Object.entries(points)
    .map(([date, value]) => ({ date, value }))
    .sort((left, right) => {
      const leftParts = left.date.split("/").map(Number);
      const rightParts = right.date.split("/").map(Number);
      const leftDate = new Date();
      const rightDate = new Date();
      leftDate.setMonth((leftParts[0] ?? 1) - 1, leftParts[1] ?? 1);
      rightDate.setMonth((rightParts[0] ?? 1) - 1, rightParts[1] ?? 1);
      return leftDate.getTime() - rightDate.getTime();
    });

  if (chartData.length === 0) {
    return <p className="empty-state">No data yet for this metric.</p>;
  }

  return (
    <section className="trend-chart">
      <h2>{metricLabel} trend</h2>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 8, left: 2 }}>
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="value" strokeWidth={3} stroke="#0f766e" />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
};
