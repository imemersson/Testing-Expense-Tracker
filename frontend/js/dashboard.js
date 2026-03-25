window.loadDashboard = async function () {
  await loadSummary();
  await loadRecentTransactions();
  await loadBudgets();
  await window.loadCharts();
};

async function loadSummary() {
  const res = await fetch(`${API_URL}/transactions/summary`, { headers: authHeaders() });
  const data = await res.json();

  document.getElementById("totalBalance").textContent = window.formatCurrency(data.balance || 0);
  document.getElementById("totalIncome").textContent = window.formatCurrency(data.income || 0);
  document.getElementById("totalExpenses").textContent = window.formatCurrency(data.expenses || 0);
  const savingsEl = document.getElementById("totalSavings");
  if (savingsEl) savingsEl.textContent = window.formatCurrency(data.savings || 0);
}

async function loadRecentTransactions() {
  const res = await fetch(`${API_URL}/transactions`, { headers: authHeaders() });
  const txs = await res.json();

  const tbody = document.querySelector("#recentTransactionsTable tbody");
  tbody.innerHTML = "";

  txs.slice(0, 5).forEach((t) => {
    const row = document.createElement("tr");
    const date = new Date(t.date).toLocaleDateString();
    const amount = t.type === "income"
      ? window.formatSignedCurrency(Number(t.amount || 0))
      : window.formatSignedCurrency(-Number(t.amount || 0));

    row.innerHTML = `
      <td>${date}</td>
      <td>${t.category}</td>
      <td class="${t.type === "income" ? "amount-positive" : "amount-negative"}">${amount}</td>
      <td><span class="badge ${t.type}">${t.type}</span></td>
    `;
    tbody.appendChild(row);
  });
}

window.loadAllTransactions = async function () {
  const res = await fetch(`${API_URL}/transactions`, { headers: authHeaders() });
  const txs = await res.json();

  const tbody = document.querySelector("#allTransactionsTable tbody");
  tbody.innerHTML = "";

  txs.forEach((t) => {
    const row = document.createElement("tr");
    const date = new Date(t.date).toLocaleDateString();
    const amount = t.type === "income"
      ? window.formatSignedCurrency(Number(t.amount || 0))
      : window.formatSignedCurrency(-Number(t.amount || 0));

    row.innerHTML = `
      <td>${date}</td>
      <td>${t.category}</td>
      <td>${t.description || "-"}</td>
      <td class="${t.type === "income" ? "amount-positive" : "amount-negative"}">${amount}</td>
      <td><span class="badge ${t.type}">${t.type}</span></td>
      <td>
        <button class="action-btn" onclick="deleteTransaction('${t._id}')">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
};

async function loadBudgets() {
  const res = await fetch(`${API_URL}/budgets`, { headers: authHeaders() });
  const budgets = await res.json();

  const txRes = await fetch(`${API_URL}/transactions`, { headers: authHeaders() });
  const txs = await txRes.json();

  const budgetsWithSpent = budgets.map((b) => {
    const spent = txs
      .filter((t) => t.type === "expense" && t.category === b.category)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    return { ...b, spent };
  });

  renderBudgets(budgetsWithSpent, "budgetCards");
}

window.loadManageBudgetPage = async function () {
  const [budgetRes, txRes, catRes] = await Promise.all([
    fetch(`${API_URL}/budgets`, { headers: authHeaders() }),
    fetch(`${API_URL}/transactions`, { headers: authHeaders() }),
    fetch(`${API_URL}/categories`, { headers: authHeaders() })
  ]);

  const budgets = await budgetRes.json();
  const txs = await txRes.json();
  const categories = await catRes.json();

  const budgetsWithSpent = budgets.map((b) => {
    const spent = txs
      .filter((t) => t.type === "expense" && t.category === b.category)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    return { ...b, spent };
  });

  renderBudgets(budgetsWithSpent, "manageBudgetCards");
  populateBudgetCategoryOptions(categories, budgets);
};

window.loadCategoriesPage = async function () {
  const res = await fetch(`${API_URL}/categories`, { headers: authHeaders() });
  const categories = await res.json();

  const grid = document.getElementById("categoriesGrid");
  grid.innerHTML = "";

  categories.forEach((cat) => {
    const div = document.createElement("div");
    div.className = "category-item";
    div.style.borderLeftColor = cat.color;

    div.innerHTML = `
      <div class="category-info">
        <span class="category-icon">${cat.icon}</span>
        <div>
          <div class="category-name">${cat.name}</div>
          <div class="category-color">${cat.color}</div>
        </div>
      </div>
      <button class="delete-category-btn" onclick="deleteCategory('${cat._id}')">
        <i class="fas fa-trash"></i>
      </button>
    `;
    grid.appendChild(div);
  });
};

function renderBudgets(budgets, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!budgets.length) {
    container.innerHTML = `
      <div class="card">
        <p style="margin:0;">No budgets yet. Use the Set Budget form to create one.</p>
      </div>
    `;
    return;
  }

  budgets.forEach((b) => {
    const allocated = Number(b.allocated || 0);
    const spent = Number(b.spent || 0);
    const remaining = allocated - spent;
    const percent = allocated > 0 ? (spent / allocated) * 100 : 0;

    const card = document.createElement("div");
    card.className = "card budget-card";

    card.innerHTML = `
      <div class="budget-card-header">
        <h4>${b.category}</h4>
        <div class="budget-card-actions">
          <button class="edit-budget-btn" onclick="editBudget('${b._id}', '${b.category}', ${allocated})" title="Edit budget">
            <i class="fas fa-pencil"></i>
          </button>
          <button class="delete-budget-btn" onclick="deleteBudget('${b._id}')" title="Delete budget">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>

      <div class="budget-info">
        <div class="budget-row"><span>Allocated:</span><span>${window.formatCurrency(allocated)}</span></div>
        <div class="budget-row"><span>Spent:</span><span class="amount-spent">${window.formatCurrency(spent)}</span></div>
        <div class="budget-row"><span>Remaining:</span><span class="amount-remaining">${window.formatCurrency(remaining)}</span></div>
      </div>

      <div class="progress-bar">
        <div class="progress-fill blue" style="width:${Math.min(percent, 100)}%"></div>
      </div>

      <p class="progress-text">${percent.toFixed(0)}% used</p>
    `;
    container.appendChild(card);
  });
}

function populateBudgetCategoryOptions(categories, budgets) {
  const select = document.getElementById("budgetCategory");
  if (!select) return;

  const categoryNames = categories.map((c) => c.name);
  const budgetedCategories = new Set(budgets.map((b) => b.category));

  const prioritized = [
    ...categoryNames.filter((name) => !budgetedCategories.has(name)),
    ...categoryNames.filter((name) => budgetedCategories.has(name))
  ];

  select.innerHTML = `<option value="">Select Category</option>`;

  prioritized.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });

  if (prioritized.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No categories available";
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
  }
}

window.editBudget = function (id, category, allocated) {
  document.getElementById("editBudgetId").value = id;
  document.getElementById("editBudgetCategory").textContent = category;
  document.getElementById("editBudgetAmount").value = allocated;
  openModal("editBudget");
};
