import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw, BarChart4 } from "lucide-react";
import "./FinancialTimeline.css"; // The Gantt overrides

interface TaskData {
  id: string;
  name: string;
  start: string;
  end?: string;
  custom_class?: string;
  price?: number;
  currency?: string;
  type?: string;
  transaction_type?: string;
  is_ongoing?: boolean;
  progress?: number;
  calculated_spent?: number;
  calculated_spent_try?: number;
  dependencies?: string;
}

interface RatesData {
  rates: { [key: string]: number };
}

export default function FinancialTimeline() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [viewMode, setViewMode] = useState<"Month" | "Year">("Year");
  const ganttRef = useRef<HTMLDivElement>(null);
  const ganttInstance = useRef<any>(null);

  const [stats, setStats] = useState({
    totalIncome: 0,
    totalExpense: 0,
    netBalance: 0,
    activeCount: 0,
  });
  const [tasks, setTasks] = useState<TaskData[]>([]);

  const fetchExchangeRates = async (): Promise<RatesData> => {
    try {
      const response = await fetch("https://open.er-api.com/v6/latest/USD");
      if (!response.ok) throw new Error("Rates API error");
      return await response.json();
    } catch (e) {
      console.error("Rates API failed, using fallbacks", e);
      return { rates: { USD: 1, EUR: 0.92, TRY: 32.25 } };
    }
  };

  const convertToTry = (amount: number, currency: string, rates: { [key: string]: number }) => {
    if (!amount || !rates) return 0;
    if (currency === "TRY") return amount;

    const rateToUsd = rates[currency];
    if (!rateToUsd) return 0;

    const amountInUsd = amount / rateToUsd;
    return amountInUsd * rates["TRY"];
  };

  const processTasks = (tasks: any[], rates: { [key: string]: number }) => {
    const today = new Date();
    const nextYear = new Date();
    nextYear.setFullYear(today.getFullYear() + 6);

    return tasks.map((task) => {
      const startDate = new Date(task.start);
      let endDate;

      if (!task.end) {
        endDate = nextYear;
        task.end = endDate.toISOString().split("T")[0];
        task.is_ongoing = true;
      } else {
        endDate = new Date(task.end);
        task.is_ongoing = false;
      }

      let totalSpent = 0;
      if (task.price) {
        if (task.type === "fixed") {
          totalSpent = task.price;
        } else if (task.type === "monthly") {
          let months = (today.getFullYear() - startDate.getFullYear()) * 12;
          months += today.getMonth() - startDate.getMonth();
          if (months < 1) months = 1;
          totalSpent = task.price * months;
        } else if (task.type === "annual") {
          let years = today.getFullYear() - startDate.getFullYear();
          if (
            today.getMonth() < startDate.getMonth() ||
            (today.getMonth() === startDate.getMonth() && today.getDate() < startDate.getDate())
          ) {
            years--;
          }
          if (years < 0) years = 0;
          totalSpent = task.price * (years + 1);
        }
      }

      task.progress = 100;
      task.calculated_spent = totalSpent;
      task.calculated_spent_try = convertToTry(totalSpent, task.currency || "TRY", rates);

      if (!task.transaction_type) {
        task.transaction_type = "expense";
      }

      return task as TaskData;
    });
  };

  const updateDashboardStats = (tasks: TaskData[]) => {
    let activeCount = 0;
    let totalIncome = 0;
    let totalExpense = 0;

    tasks.forEach((task) => {
      if (task.is_ongoing || new Date(task.end!) > new Date()) {
        activeCount++;
      }

      if (task.transaction_type === "income") {
        totalIncome += task.calculated_spent_try || 0;
      } else {
        totalExpense += task.calculated_spent_try || 0;
      }
    });

    const netBalance = totalIncome - totalExpense;
    setStats({ totalIncome, totalExpense, netBalance, activeCount });
  };

  const initGantt = (tasksToRender: TaskData[]) => {
    if (!ganttRef.current) return;
    
    const Gantt = (window as any).Gantt;
    if (!Gantt) {
      console.error("Frappe Gantt CDN is not loaded.");
      return;
    }
    
    // Clear the container to prevent double rendering in React StrictMode
    ganttRef.current.innerHTML = "";

    // Override internal binding methods to make it strictly read-only
    if (Gantt && Gantt.prototype) {
      Gantt.prototype.bind_bar_events = function () {};
      Gantt.prototype.bind_bar_progress = function () {};
    }

    ganttInstance.current = new Gantt(ganttRef.current, tasksToRender, {
      view_mode: viewMode,
      readonly: true,
      language: "tr",
      custom_popup_html: function (task: TaskData) {
        const is_fixed = task.type === "fixed";
        const date_text = is_fixed
          ? `Tarih: ${task.start}`
          : task.is_ongoing
          ? `Başlangıç: ${task.start} (Devam Ediyor)`
          : `Bitiş: ${task.end}`;

        const type_tr = task.type === "annual" ? "Yıllık" : task.type === "monthly" ? "Aylık" : "Tek Seferlik";
        const trans_type_tr = task.transaction_type === "income" ? "Gelir" : "Gider";

        let price_text = "";
        let total_text = "";

        if (task.price) {
          price_text = `${trans_type_tr}: ${task.price} ${task.currency || ""} / ${type_tr}`;

          total_text = `Biriken Toplam: ${task.calculated_spent!.toFixed(2)} ${task.currency || ""}`;
          if (task.currency !== "TRY") {
            total_text += ` <br><small class="text-muted-foreground">(~${task.calculated_spent_try!.toFixed(2)} ₺)</small>`;
          }
        }

        return `
          <div class="details-container">
            <div class="title">${task.name} <span style="font-size: 0.8em; color: ${
          task.transaction_type === "income" ? "#10b981" : "#ef4444"
        };">(${trans_type_tr})</span></div>
            <div class="subtitle">
              ${date_text}<br>
              ${price_text}<br>
              ${total_text}
            </div>
          </div>
        `;
      },
    });
  };

  const loadData = async () => {
    setLoading(true);
    setError(false);
    try {
      const [dataRes, ratesData] = await Promise.all([
        //fetch(`${import.meta.env.BASE_URL}finance-data.json?t=${new Date().getTime()}`),
        fetch(`https://raw.githubusercontent.com/Purgatoria/Timeline-View/refs/heads/main/data.json?t=${new Date().getTime()}`),
        fetchExchangeRates(),
      ]);

      if (!dataRes.ok) throw new Error("Failed to load timeline data");
      const rawData = await dataRes.json();

      const processedTasks = processTasks(rawData, ratesData.rates);
      updateDashboardStats(processedTasks);
      setTasks(processedTasks);
    } catch (err) {
      console.error(err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && !error && tasks.length > 0) {
      initGantt(tasks);
    }
  }, [loading, error, tasks]);

  useEffect(() => {
    if (ganttInstance.current && !loading && !error && tasks.length > 0) {
      ganttInstance.current.change_view_mode(viewMode);
    }
  }, [viewMode]);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);

  return (
    <section className="py-24 px-4 border-t border-border bg-card/30">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BarChart4 className="w-5 h-5 text-primary" />
              <Badge variant="outline" className="border-primary/40 text-primary">
                Finansal Saydamlık
              </Badge>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold">Gelir & Gider Tablosu</h2>
            <p className="text-muted-foreground mt-2">
              Topluluğumuzun finansal işlemlerinin şeffaf zaman çizelgesi.
            </p>
          </div>
        </div>

        {/* Dashboard Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Toplam Gelir</span>
              <span className="text-xl md:text-2xl font-bold text-emerald-500">
                {formatCurrency(stats.totalIncome)}
              </span>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Toplam Gider</span>
              <span className="text-xl md:text-2xl font-bold text-rose-500">
                {formatCurrency(stats.totalExpense)}
              </span>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Net Durum</span>
              <span
                className={`text-xl md:text-2xl font-bold ${
                  stats.netBalance > 0 ? "text-emerald-500" : stats.netBalance < 0 ? "text-rose-500" : ""
                }`}
              >
                {formatCurrency(stats.netBalance)}
              </span>
            </CardContent>
          </Card>
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Aktif Kalemler</span>
              <span className="text-xl md:text-2xl font-bold">{stats.activeCount}</span>
            </CardContent>
          </Card>
        </div>

        {/* Gantt Wrapper */}
        <div className="bg-card border border-border rounded-xl p-4 md:p-6 shadow-sm">
          <div className="flex justify-end gap-2 mb-6 border-b border-border pb-4">
            <Button
              variant={viewMode === "Month" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("Month")}
            >
              Ay
            </Button>
            <Button
              variant={viewMode === "Year" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("Year")}
            >
              Yıl
            </Button>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin text-primary" />
              <p>Zaman çizelgesi yükleniyor...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
              <Activity className="w-6 h-6 text-rose-500" />
              <p>Veri yüklenemedi. Lütfen bağlantınızı kontrol edin.</p>
              <Button variant="outline" size="sm" onClick={loadData}>
                Tekrar Dene
              </Button>
            </div>
          )}

          <div
            className={`w-full overflow-x-auto ${loading || error ? "hidden" : "block"}`}
          >
            <div ref={ganttRef} className="gantt-target w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
