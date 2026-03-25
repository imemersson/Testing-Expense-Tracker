let spendingChart = null;
let trendsChart = null;

window.loadCharts = async function () {
  const res = await fetch(`${API_URL}/transactions`, { headers: authHeaders() });
  const txs = await res.json();

  loadSpendingChart(txs);
  loadTrendsChart(txs);
};

function loadSpendingChart(txs) {
  const expensesByCategory = txs
    .filter((t) => t.type === "expense")
    .reduce((acc, t) => {
      const category = t.category || "Other";
      acc[category] = (acc[category] || 0) + Number(t.amount || 0);
      return acc;
    }, {});

  const labels = Object.keys(expensesByCategory);
  const values = Object.values(expensesByCategory);

  if (labels.length === 0) {
    labels.push("No expense data");
    values.push(1);
  }

  const palette = [
    "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
    "#8B5CF6", "#14B8A6", "#EC4899", "#6366F1",
    "#84CC16", "#0EA5E9", "#F97316", "#22C55E"
  ];

  const ctx = document.getElementById("spendingChart").getContext("2d");
  if (spendingChart) spendingChart.destroy();

  spendingChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderColor: "#ffffff",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.label || "";
              const value = context.parsed || 0;
              return `${label}: ${window.formatCurrency(value)}`;
            }
          }
        }
      }
    }
  });
}

function loadTrendsChart(txs) {
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const incomeData = new Array(12).fill(0);
  const expenseData = new Array(12).fill(0);

  txs.forEach((t) => {
    const d = new Date(t.date);
    if (Number.isNaN(d.getTime())) return;
    if (t.type !== "income" && t.type !== "expense") return;

    const monthIndex = d.getMonth();
    const amount = Number(t.amount || 0);

    if (t.type === "income") incomeData[monthIndex] += amount;
    else expenseData[monthIndex] += amount;
  });

  const ctx = document.getElementById("trendsChart").getContext("2d");
  if (trendsChart) trendsChart.destroy();

  trendsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Income",
          data: incomeData,
          borderColor: "#10B981",
          backgroundColor: "rgba(16, 185, 129, 0.15)",
          fill: true,
          tension: 0.3
        },
        {
          label: "Expense",
          data: expenseData,
          borderColor: "#EF4444",
          backgroundColor: "rgba(239, 68, 68, 0.15)",
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label(context) {
              const series = context.dataset.label || "";
              return `${series}: ${window.formatCurrency(context.parsed.y || 0)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback(value) {
              return window.formatCurrency(value);
            }
          }
        }
      }
    }
  });
}
