// app.js - Controller and UI Logic for Ops Work Tracker

// State Management
let currentActivities = [];
let currentMachines = [];
let uploadedPhotos = []; // elements: { blob, caption, id }
let allLogs = [];
let filteredLogs = [];

// Pre-defined values
const DEFAULT_ACTIVITIES = [
  'Loading',
  'Unloading',
  'Sorting',
  'Disassembling (packages, lids, etc.)',
  'Warehouse Cleaning',
  'Animal Feed Production',
  'Filling IBC Tanks',
  'Working in Machines',
  'Others'
];

const DEFAULT_MACHINES = [
  'Depackaging Machine',
  'Biodigester Machine',
  'Glass Crusher',
  'Shredder Machines',
  'Liquid Drainer',
  'Aerosol Processor'
];

// Injected CSS for Custom Charts
const chartStyles = `
.custom-bar-chart {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.5rem 0;
  height: 100%;
}
.chart-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.chart-row-label {
  width: 140px;
  min-width: 140px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}
.chart-row-bar-wrapper {
  flex-grow: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.chart-row-bar {
  height: 16px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--primary-hover) 100%);
  border-radius: 4px;
  min-width: 4px;
  transition: width 0.5s ease-out;
}
.chart-row-value {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-main);
  min-width: 40px;
}
`;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  // Inject chart styles
  const styleEl = document.createElement('style');
  styleEl.textContent = chartStyles;
  document.head.appendChild(styleEl);

  // Initialize Database
  try {
    await window.dbService.init();
    await loadLogsAndRefresh();
  } catch (err) {
    console.error('Failed to initialize database:', err);
    showToast('Database error: ' + err.message, 'error');
  }

  // Setup Event Listeners
  setupNavigation();
  setupFormDynamicControls();
  setupPhotoUploader();
  setupFilterControls();
  setupUtilityActions();
  setupConnectionStatus();
  
  // Set default values for New Entry Date
  document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
  
  // Load last entered supervisor name or default to Zahir
  const lastSupervisor = localStorage.getItem('lastSupervisor');
  document.getElementById('form-supervisor').value = lastSupervisor || 'Zahir';
});

// Toast Notification Helper
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show';
  if (type === 'error') {
    toast.classList.add('error');
  }
  setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
}

// Connection Status Monitor
function setupConnectionStatus() {
  const updateStatus = () => {
    const badge = document.getElementById('connection-badge');
    const badgeText = badge.querySelector('.badge-text');
    if (navigator.onLine) {
      badge.className = 'connection-badge online';
      badgeText.textContent = 'Online';
    } else {
      badge.className = 'connection-badge offline';
      badgeText.textContent = 'Offline (Saved Local)';
    }
  };
  
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

// Navigation Handling
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      
      // Update active nav button
      navItems.forEach(btn => {
        if (btn.getAttribute('data-tab') === targetTab) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Update active tab panel
      tabContents.forEach(tab => {
        if (tab.id === targetTab) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });


    });
  });

  // Short-cuts to tabs
  document.getElementById('new-log-shortcut-btn').addEventListener('click', () => {
    triggerTabSwitch('new-entry-tab');
  });
  
  document.getElementById('form-cancel-btn').addEventListener('click', () => {
    resetForm();
    triggerTabSwitch('dashboard-tab');
  });
}

function triggerTabSwitch(tabId) {
  const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  
  navItems.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  tabContents.forEach(tab => {
    if (tab.id === tabId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  

}

// Load Logs and Refresh UI
async function loadLogsAndRefresh() {
  try {
    allLogs = await window.dbService.getLogs();
    applyFilters();
  } catch (err) {
    console.error('Error fetching logs:', err);
    showToast('Failed to load logs', 'error');
  }
}

// Filtering Logic
function setupFilterControls() {
  const searchInput = document.getElementById('search-is');
  const shiftSelect = document.getElementById('filter-shift');
  const startDateInput = document.getElementById('filter-start-date');
  const endDateInput = document.getElementById('filter-end-date');
  const clearBtn = document.getElementById('clear-filters-btn');

  const onFilterChange = () => {
    applyFilters();
  };

  searchInput.addEventListener('input', onFilterChange);
  shiftSelect.addEventListener('change', onFilterChange);
  startDateInput.addEventListener('change', onFilterChange);
  endDateInput.addEventListener('change', onFilterChange);
  
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    shiftSelect.value = 'all';
    startDateInput.value = '';
    endDateInput.value = '';
    applyFilters();
  });
}

function applyFilters() {
  const searchVal = document.getElementById('search-is').value.toLowerCase().trim();
  const shiftVal = document.getElementById('filter-shift').value;
  const startVal = document.getElementById('filter-start-date').value;
  const endVal = document.getElementById('filter-end-date').value;

  filteredLogs = allLogs.filter(log => {
    // Search by IS Number
    const matchesSearch = !searchVal || log.isNumber.toLowerCase().includes(searchVal) || 
                          (log.supervisor && log.supervisor.toLowerCase().includes(searchVal)) ||
                          (log.activities && log.activities.some(a => a.type.toLowerCase().includes(searchVal)));
    
    // Filter by Shift
    const matchesShift = shiftVal === 'all' || log.shift === shiftVal;
    
    // Filter by Date Range
    const logDate = log.date;
    const matchesStart = !startVal || logDate >= startVal;
    const matchesEnd = !endVal || logDate <= endVal;

    return matchesSearch && matchesShift && matchesStart && matchesEnd;
  });

  renderDashboardList();
  calculateKPIs();
}

// Compute and Render KPI Card Stats
function calculateKPIs() {
  const totalDays = allLogs.length;
  document.getElementById('kpi-days').textContent = totalDays;

  // Average Daily Employees
  let dailyLaborSum = 0;
  allLogs.forEach(log => {
    if (log.activities) {
      log.activities.forEach(act => {
        dailyLaborSum += (Number(act.internalCount) || 0) + (Number(act.extraCount) || 0);
      });
    }
  });
  const avgLabor = totalDays > 0 ? Math.round(dailyLaborSum / totalDays) : 0;
  document.getElementById('kpi-labor').textContent = avgLabor;

  // Machine Hours Sum
  let totalMachineHours = 0;
  allLogs.forEach(log => {
    if (log.machines) {
      log.machines.forEach(mach => {
        totalMachineHours += (Number(mach.netHours) || 0);
      });
    }
  });
  document.getElementById('kpi-machine').textContent = Math.round(totalMachineHours) + ' hrs';

  // Active Unique IS Numbers
  const uniqueIS = new Set(allLogs.map(log => log.isNumber.toUpperCase().trim()));
  document.getElementById('kpi-isnumbers').textContent = uniqueIS.size;
}

// Render Dashboard Logs List
function renderDashboardList() {
  const logsList = document.getElementById('logs-list');
  const emptyState = document.getElementById('empty-state');
  
  logsList.innerHTML = '';
  
  if (filteredLogs.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  
  emptyState.style.display = 'none';
  
  filteredLogs.forEach(log => {
    const card = document.createElement('div');
    card.className = 'log-card';
    
    // Calculate total workers and overtime for this log card
    let intLabor = 0;
    let extLabor = 0;
    let totalOt = 0;
    if (log.activities) {
      log.activities.forEach(a => {
        intLabor += Number(a.internalCount) || 0;
        extLabor += Number(a.extraCount) || 0;
        totalOt += (Number(a.internalOt) || 0) + (Number(a.extraOt) || 0);
      });
    }
    const totalLabor = intLabor + extLabor;
    
    // Calculate total machine hours for this log card
    let machHours = 0;
    if (log.machines) {
      log.machines.forEach(m => {
        machHours += Number(m.netHours) || 0;
      });
    }

    // Format activities string
    const activitiesStr = log.activities && log.activities.length > 0 
      ? log.activities.map(a => a.type).join(', ') 
      : 'No activities entered';
      
    // Count associated photos
    const photoCountStr = log.photoCount ? `📸 ${log.photoCount} photo${log.photoCount > 1 ? 's' : ''}` : '';

    // Date Format
    const formattedDate = formatDateString(log.date);

    card.innerHTML = `
      <div class="log-card-header">
        <div class="log-card-title">
          <h4>${escapeHTML(log.isNumber)}</h4>
          <span class="badge badge-${log.shift.toLowerCase()}">${log.shift}</span>
        </div>
        <span class="log-card-date">${formattedDate}</span>
      </div>
      
      <div class="log-card-meta">
        <div class="meta-icon-text">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
          <span>Labor: <strong>${totalLabor}</strong> (${intLabor} int / ${extLabor} ext)${totalOt ? ` + <strong>${totalOt}h OT</strong>` : ''}</span>
        </div>
        <div class="meta-icon-text">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <span>Machines: <strong>${machHours} hrs</strong></span>
        </div>
        ${photoCountStr ? `
        <div class="meta-icon-text" style="color: var(--primary);">
          <span>${photoCountStr}</span>
        </div>` : ''}
      </div>
      
      <div class="log-card-activities">
        <strong>Tasks:</strong> ${escapeHTML(activitiesStr)}
      </div>
      
      <div class="log-card-footer">
        <span>Supervisor: <strong>${escapeHTML(log.supervisor)}</strong></span>
        <div class="log-card-actions">
          <button class="btn btn-secondary btn-sm card-view-btn" data-id="${log.id}">Details</button>
        </div>
      </div>
    `;
    
    // Clicking card opens details
    card.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        openDetailsModal(log.id);
      }
    });
    
    card.querySelector('.card-view-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailsModal(log.id);
    });

    logsList.appendChild(card);
  });
}

// Form Dynamic Operations (Labor Activities & Machine Rows)
function setupFormDynamicControls() {
  const addActivityBtn = document.getElementById('add-activity-btn');
  const addMachineBtn = document.getElementById('add-machine-btn');
  
  addActivityBtn.addEventListener('click', () => {
    currentActivities.push({
      type: DEFAULT_ACTIVITIES[0],
      internalCount: 0,
      internalOt: 0,
      extraCount: 0,
      extraOt: 0,
      notes: ''
    });
    renderActivities();
  });

  addMachineBtn.addEventListener('click', () => {
    currentMachines.push({
      name: DEFAULT_MACHINES[0],
      operator: '',
      startTime: '',
      endTime: '',
      breakMinutes: 0,
      netHours: 0,
      production: ''
    });
    renderMachines();
  });

  // Handle Form Submission
  const form = document.getElementById('work-log-form');
  form.addEventListener('submit', handleFormSubmit);
}

// Render Labor Activities Form Section
function renderActivities() {
  const listDesktop = document.getElementById('activities-list');
  const listMobile = document.getElementById('activities-mobile-cards');
  
  listDesktop.innerHTML = '';
  listMobile.innerHTML = '';
  
  currentActivities.forEach((act, index) => {
    // Generate Dropdown Options HTML
    let optionsHtml = '';
    DEFAULT_ACTIVITIES.forEach(opt => {
      optionsHtml += `<option value="${opt}" ${act.type === opt ? 'selected' : ''}>${opt}</option>`;
    });

    // 1. Render Desktop Table Row
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <select onchange="updateActivityField(${index}, 'type', this.value)">
          ${optionsHtml}
        </select>
      </td>
      <td>
        <input type="number" min="0" value="${act.internalCount}" oninput="updateActivityField(${index}, 'internalCount', parseInt(this.value) || 0)">
      </td>
      <td>
        <input type="number" min="0" step="0.5" value="${act.internalOt || 0}" oninput="updateActivityField(${index}, 'internalOt', parseFloat(this.value) || 0)">
      </td>
      <td>
        <input type="number" min="0" value="${act.extraCount}" oninput="updateActivityField(${index}, 'extraCount', parseInt(this.value) || 0)">
      </td>
      <td>
        <input type="number" min="0" step="0.5" value="${act.extraOt || 0}" oninput="updateActivityField(${index}, 'extraOt', parseFloat(this.value) || 0)">
      </td>
      <td>
        <input type="text" placeholder="e.g. Sorted 12 tons carton" value="${escapeHTML(act.notes)}" oninput="updateActivityField(${index}, 'notes', this.value)">
      </td>
      <td>
        <button type="button" class="icon-btn" style="color: var(--red);" onclick="removeActivity(${index})">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </td>
    `;
    listDesktop.appendChild(tr);

    // 2. Render Mobile Card
    const card = document.createElement('div');
    card.className = 'mobile-activity-card';
    card.innerHTML = `
      <button type="button" class="card-remove-btn-absolute" onclick="removeActivity(${index})">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
      <div class="form-control">
        <label>Activity Type</label>
        <select onchange="updateActivityField(${index}, 'type', this.value)">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 0.5rem;">
        <div class="form-control">
          <label>Internal Workers</label>
          <input type="number" min="0" value="${act.internalCount}" oninput="updateActivityField(${index}, 'internalCount', parseInt(this.value) || 0)">
        </div>
        <div class="form-control">
          <label>Internal Overtime (hours)</label>
          <input type="number" min="0" step="0.5" value="${act.internalOt || 0}" oninput="updateActivityField(${index}, 'internalOt', parseFloat(this.value) || 0)">
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 0.5rem;">
        <div class="form-control">
          <label>Extra Labor Workers</label>
          <input type="number" min="0" value="${act.extraCount}" oninput="updateActivityField(${index}, 'extraCount', parseInt(this.value) || 0)">
        </div>
        <div class="form-control">
          <label>Extra Overtime (hours)</label>
          <input type="number" min="0" step="0.5" value="${act.extraOt || 0}" oninput="updateActivityField(${index}, 'extraOt', parseFloat(this.value) || 0)">
        </div>
      </div>
      <div class="form-control">
        <label>Task Description / Output</label>
        <input type="text" placeholder="e.g. Sorted 12 tons carton" value="${escapeHTML(act.notes)}" oninput="updateActivityField(${index}, 'notes', this.value)">
      </div>
    `;
    listMobile.appendChild(card);
  });

  calculateLaborTotals();
}

window.updateActivityField = function(index, field, value) {
  currentActivities[index][field] = value;
  if (field === 'internalCount' || field === 'extraCount' || field === 'internalOt' || field === 'extraOt') {
    calculateLaborTotals();
  }
};

window.removeActivity = function(index) {
  currentActivities.splice(index, 1);
  renderActivities();
};

function calculateLaborTotals() {
  let totalInternal = 0;
  let totalInternalOt = 0;
  let totalExtra = 0;
  let totalExtraOt = 0;
  
  currentActivities.forEach(act => {
    totalInternal += act.internalCount || 0;
    totalInternalOt += act.internalOt || 0;
    totalExtra += act.extraCount || 0;
    totalExtraOt += act.extraOt || 0;
  });
  
  document.getElementById('total-internal-badge').textContent = totalInternal;
  document.getElementById('total-internal-ot-badge').textContent = `(${totalInternalOt}h Overtime)`;
  document.getElementById('total-extra-badge').textContent = totalExtra;
  document.getElementById('total-extra-ot-badge').textContent = `(${totalExtraOt}h Overtime)`;
}

// Render Machine Logs Form Section
function renderMachines() {
  const listDesktop = document.getElementById('machines-list');
  const listMobile = document.getElementById('machines-mobile-cards');
  
  listDesktop.innerHTML = '';
  listMobile.innerHTML = '';
  
  currentMachines.forEach((mach, index) => {
    // Generate Dropdown Options HTML
    let optionsHtml = '';
    DEFAULT_MACHINES.forEach(opt => {
      optionsHtml += `<option value="${opt}" ${mach.name === opt ? 'selected' : ''}>${opt}</option>`;
    });

    // 1. Render Desktop Table Row
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <select onchange="updateMachineField(${index}, 'name', this.value)">
          ${optionsHtml}
        </select>
      </td>
      <td>
        <input type="text" placeholder="e.g. Zahir, Adhil, John" value="${escapeHTML(mach.operator)}" oninput="updateMachineField(${index}, 'operator', this.value)">
      </td>
      <td>
        <input type="time" value="${mach.startTime}" oninput="updateMachineTime(${index}, 'startTime', this.value)">
      </td>
      <td>
        <input type="time" value="${mach.endTime}" oninput="updateMachineTime(${index}, 'endTime', this.value)">
      </td>
      <td>
        <input type="number" min="0" placeholder="0" value="${mach.breakMinutes}" oninput="updateMachineTime(${index}, 'breakMinutes', parseInt(this.value) || 0)">
      </td>
      <td style="font-weight: 600; color: var(--primary);">
        <span id="desktop-net-hours-${index}">${mach.netHours.toFixed(2)}</span> h
      </td>
      <td>
        <input type="text" placeholder="e.g. 15 bales / 4 tons" value="${escapeHTML(mach.production)}" oninput="updateMachineField(${index}, 'production', this.value)">
      </td>
      <td>
        <button type="button" class="icon-btn" style="color: var(--red);" onclick="removeMachine(${index})">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </td>
    `;
    listDesktop.appendChild(tr);

    // 2. Render Mobile Card
    const card = document.createElement('div');
    card.className = 'mobile-machine-card';
    card.innerHTML = `
      <button type="button" class="card-remove-btn-absolute" onclick="removeMachine(${index})">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
      <div class="form-control">
        <label>Machine Name</label>
        <select onchange="updateMachineField(${index}, 'name', this.value)">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-control">
        <label>Operator(s) / Helper(s) (1-3 people)</label>
        <input type="text" placeholder="e.g. Zahir, Adhil, John" value="${escapeHTML(mach.operator)}" oninput="updateMachineField(${index}, 'operator', this.value)">
      </div>
      
      <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 0.5rem;">
        <div class="form-control">
          <label>Start Time</label>
          <input type="time" value="${mach.startTime}" oninput="updateMachineTime(${index}, 'startTime', this.value)">
        </div>
        <div class="form-control">
          <label>End Time</label>
          <input type="time" value="${mach.endTime}" oninput="updateMachineTime(${index}, 'endTime', this.value)">
        </div>
      </div>
      
      <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: center;">
        <div class="form-control">
          <label>Break (minutes)</label>
          <input type="number" min="0" placeholder="0" value="${mach.breakMinutes}" oninput="updateMachineTime(${index}, 'breakMinutes', parseInt(this.value) || 0)">
        </div>
        <div class="form-control">
          <label>Net Hours</label>
          <span style="font-weight: 600; color: var(--primary); font-size: 1.1rem;" id="mobile-net-hours-${index}">${mach.netHours.toFixed(2)} hrs</span>
        </div>
      </div>

      <div class="form-control">
        <label>Production / Material Output</label>
        <input type="text" placeholder="e.g. 15 bales / 4 tons" value="${escapeHTML(mach.production)}" oninput="updateMachineField(${index}, 'production', this.value)">
      </div>
    `;
    listMobile.appendChild(card);
  });
}

window.updateMachineField = function(index, field, value) {
  currentMachines[index][field] = value;
};

window.updateMachineTime = function(index, field, value) {
  currentMachines[index][field] = value;
  
  // Calculate running hours
  const start = currentMachines[index].startTime;
  const end = currentMachines[index].endTime;
  const breakMin = currentMachines[index].breakMinutes || 0;
  
  const netHours = calculateNetHours(start, end, breakMin);
  currentMachines[index].netHours = netHours;
  
  // Dynamic update outputs
  const deskEl = document.getElementById(`desktop-net-hours-${index}`);
  const mobEl = document.getElementById(`mobile-net-hours-${index}`);
  
  if (deskEl) deskEl.textContent = netHours.toFixed(2);
  if (mobEl) mobEl.textContent = netHours.toFixed(2) + ' hrs';
};

window.removeMachine = function(index) {
  currentMachines.splice(index, 1);
  renderMachines();
};

function calculateNetHours(startTime, endTime, breakMinutes) {
  if (!startTime || !endTime) return 0;
  
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  
  // Midnight crossover
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }
  
  const netMinutes = endMinutes - startMinutes - Number(breakMinutes);
  return Math.max(0, Math.round((netMinutes / 60) * 100) / 100);
}

// Photos Uploader System
function setupPhotoUploader() {
  const dropzone = document.getElementById('dropzone');
  const photoInput = document.getElementById('photo-input');
  
  dropzone.addEventListener('click', () => {
    photoInput.click();
  });
  
  // Drag and drop event listeners
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--primary)';
    }, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    }, false);
  });
  
  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    handlePhotoFiles(files);
  });
  
  photoInput.addEventListener('change', (e) => {
    handlePhotoFiles(e.target.files);
  });
}

async function handlePhotoFiles(files) {
  if (!files || files.length === 0) return;
  
  showToast(`Processing ${files.length} photo(s)...`);
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) {
      showToast('File must be an image', 'error');
      continue;
    }
    
    try {
      const compressedBlob = await compressImage(file);
      const id = Date.now() + Math.random().toString(36).substr(2, 5);
      uploadedPhotos.push({
        id: id,
        blob: compressedBlob,
        caption: '',
        previewUrl: URL.createObjectURL(compressedBlob)
      });
    } catch (err) {
      console.error('Image compression error:', err);
      showToast('Error loading image', 'error');
    }
  }
  
  renderPhotoPreviews();
}

// Image Compression via Canvas
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; // Resize high-res mobile photos to save db space
        let width = img.width;
        let height = img.height;
        
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas blob is null'));
          }
        }, 'image/jpeg', 0.7); // 70% JPEG quality is optimal for Ops reviews
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreviews() {
  const container = document.getElementById('photo-previews');
  container.innerHTML = '';
  
  uploadedPhotos.forEach((photo, idx) => {
    const div = document.createElement('div');
    div.className = 'photo-preview-item';
    div.innerHTML = `
      <div class="preview-img-wrapper">
        <img src="${photo.previewUrl}" alt="Preview">
        <button type="button" class="remove-photo-btn" onclick="removePhoto('${photo.id}')">&times;</button>
      </div>
      <input type="text" class="photo-caption-input" placeholder="Add caption..." value="${escapeHTML(photo.caption)}" oninput="updatePhotoCaption('${photo.id}', this.value)">
    `;
    container.appendChild(div);
  });
}

window.updatePhotoCaption = function(id, val) {
  const photo = uploadedPhotos.find(p => p.id === id);
  if (photo) photo.caption = val;
};

window.removePhoto = function(id) {
  const idx = uploadedPhotos.findIndex(p => p.id === id);
  if (idx > -1) {
    URL.revokeObjectURL(uploadedPhotos[idx].previewUrl); // Clear memory
    uploadedPhotos.splice(idx, 1);
  }
  renderPhotoPreviews();
};

// Form Reset
function resetForm() {
  document.getElementById('edit-log-id').value = '';
  document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('form-is-number').value = '';
  document.getElementById('form-remarks').value = '';
  
  // Clean memory URLs
  uploadedPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl));
  uploadedPhotos = [];
  currentActivities = [];
  currentMachines = [];
  
  renderActivities();
  renderMachines();
  renderPhotoPreviews();
  
  // Reset supervisor to last used or Zahir
  const lastSupervisor = localStorage.getItem('lastSupervisor');
  document.getElementById('form-supervisor').value = lastSupervisor || 'Zahir';
  
  document.getElementById('form-submit-btn').textContent = 'Save Work Log';
}

// Handle Form Submit (Insert / Update)
async function handleFormSubmit(e) {
  e.preventDefault();
  
  const idVal = document.getElementById('edit-log-id').value;
  const date = document.getElementById('form-date').value;
  const shift = document.getElementById('form-shift').value;
  const isNumber = document.getElementById('form-is-number').value.trim();
  const supervisor = document.getElementById('form-supervisor').value.trim();
  const remarks = document.getElementById('form-remarks').value.trim();
  
  if (!date || !shift || !isNumber || !supervisor) {
    showToast('Please fill all required general fields', 'error');
    return;
  }
  
  if (currentActivities.length === 0) {
    showToast('Please add at least one labor activity task', 'error');
    return;
  }

  // Save supervisor to memory
  localStorage.setItem('lastSupervisor', supervisor);

  const logObj = {
    date,
    shift,
    isNumber,
    supervisor,
    activities: currentActivities,
    machines: currentMachines,
    remarks,
    photoCount: uploadedPhotos.length,
    timestamp: Date.now()
  };

  if (idVal) {
    logObj.id = Number(idVal);
  }

  try {
    const savedId = await window.dbService.saveLog(logObj, uploadedPhotos);
    showToast(idVal ? 'Work log updated successfully!' : 'Work log saved successfully!');
    resetForm();
    await loadLogsAndRefresh();
    triggerTabSwitch('dashboard-tab');
  } catch (err) {
    console.error('Error saving log:', err);
    showToast('Error saving log: ' + err.message, 'error');
  }
}

// Modal View Details Logic
async function openDetailsModal(id) {
  const modal = document.getElementById('details-modal');
  
  try {
    const data = await window.dbService.getLog(id);
    if (!data) {
      showToast('Log not found', 'error');
      return;
    }
    
    const { log, photos } = data;
    
    // Inject Title & Metadata
    document.getElementById('modal-title-is').textContent = log.isNumber;
    document.getElementById('modal-subtitle-date').textContent = `${formatDateString(log.date)} - ${log.shift} Shift`;
    document.getElementById('modal-detail-supervisor').textContent = log.supervisor;
    
    // Total employees count & Overtime
    let totalEmployees = 0;
    let totalOtHours = 0;
    log.activities.forEach(a => {
      totalEmployees += (a.internalCount || 0) + (a.extraCount || 0);
      totalOtHours += (Number(a.internalOt) || 0) + (Number(a.extraOt) || 0);
    });
    document.getElementById('modal-detail-labor').textContent = `${totalEmployees} Worker${totalEmployees !== 1 ? 's' : ''}` + (totalOtHours ? ` (${totalOtHours}h OT)` : '');
    
    // Total machine hours
    let totalMachHours = 0;
    log.machines.forEach(m => {
      totalMachHours += m.netHours || 0;
    });
    document.getElementById('modal-detail-machine').textContent = `${totalMachHours.toFixed(2)} hrs`;

    // 1. Inject Activities
    const actContainer = document.getElementById('modal-detail-activities');
    actContainer.innerHTML = '';
    if (log.activities.length === 0) {
      actContainer.innerHTML = '<p class="text-secondary">No activities listed</p>';
    } else {
      log.activities.forEach(act => {
        const item = document.createElement('div');
        item.className = 'detail-item-card';
        
        const intOtStr = act.internalOt ? ` (OT: ${act.internalOt}h)` : '';
        const extOtStr = act.extraOt ? ` (OT: ${act.extraOt}h)` : '';
        
        item.innerHTML = `
          <div class="detail-item-header">
            <span>${escapeHTML(act.type)}</span>
            <span style="color: var(--primary);">
              Int: ${act.internalCount || 0}${intOtStr} | Ext: ${act.extraCount || 0}${extOtStr}
            </span>
          </div>
          <div class="detail-item-content">
            ${escapeHTML(act.notes || 'No description provided')}
          </div>
        `;
        actContainer.appendChild(item);
      });
    }

    // 2. Inject Machines
    const machContainer = document.getElementById('modal-detail-machines');
    machContainer.innerHTML = '';
    if (log.machines.length === 0) {
      machContainer.innerHTML = '<p class="text-secondary">No machines run</p>';
    } else {
      log.machines.forEach(m => {
        const item = document.createElement('div');
        item.className = 'detail-item-card';
        item.innerHTML = `
          <div class="detail-item-header">
            <span>⚙️ ${escapeHTML(m.name)}</span>
            <span style="color: var(--orange);">${m.netHours.toFixed(2)} hrs</span>
          </div>
          <div class="detail-item-content" style="display: flex; flex-direction: column; gap: 0.15rem;">
            <span>Operator: <strong>${escapeHTML(m.operator || 'None')}</strong></span>
            <span>Duration: ${m.startTime} to ${m.endTime} (Break: ${m.breakMinutes || 0}m)</span>
            ${m.production ? `<span>Production/Output: <strong>${escapeHTML(m.production)}</strong></span>` : ''}
          </div>
        `;
        machContainer.appendChild(item);
      });
    }

    // 3. Inject Gallery Photos
    const gallery = document.getElementById('modal-detail-gallery');
    gallery.innerHTML = '';
    
    if (photos.length === 0) {
      gallery.parentElement.style.display = 'none';
    } else {
      gallery.parentElement.style.display = 'block';
      photos.forEach(photo => {
        const imgUrl = URL.createObjectURL(photo.blob);
        const item = document.createElement('div');
        item.className = 'detail-gallery-item';
        item.innerHTML = `<img src="${imgUrl}" alt="Work pic">`;
        
        item.addEventListener('click', () => {
          openLightbox(imgUrl, photo.caption);
        });
        
        gallery.appendChild(item);
      });
    }

    // 4. Inject Remarks
    const remarksEl = document.getElementById('modal-detail-remarks');
    const remarksSection = document.getElementById('modal-detail-remarks-section');
    if (log.remarks) {
      remarksSection.style.display = 'block';
      remarksEl.textContent = log.remarks;
    } else {
      remarksSection.style.display = 'none';
    }

    // Set Actions on buttons
    const deleteBtn = document.getElementById('modal-delete-btn');
    const editBtn = document.getElementById('modal-edit-btn');
    const closeBtn = document.getElementById('close-modal-btn');
    const closeBottomBtn = document.getElementById('modal-close-bottom-btn');
    
    const closeModal = () => {
      // Clear memory references
      const images = gallery.querySelectorAll('img');
      images.forEach(img => URL.revokeObjectURL(img.src));
      modal.classList.remove('active');
    };

    closeBtn.onclick = closeModal;
    closeBottomBtn.onclick = closeModal;
    document.querySelector('.modal-overlay').onclick = closeModal;
    
    deleteBtn.onclick = async () => {
      if (confirm(`Are you sure you want to delete work log for IS Number ${log.isNumber}?`)) {
        await window.dbService.deleteLog(log.id);
        showToast('Work log deleted successfully.');
        closeModal();
        await loadLogsAndRefresh();
      }
    };

    editBtn.onclick = () => {
      closeModal();
      populateFormForEdit(log, photos);
    };

    modal.classList.add('active');

  } catch (err) {
    console.error('Error loading log detail:', err);
    showToast('Failed to load log details', 'error');
  }
}

// Lightbox Photo Viewer
function openLightbox(url, caption) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  
  img.src = url;
  cap.textContent = caption || 'Operations Snapshot';
  lightbox.style.display = 'flex';
  
  const close = () => {
    lightbox.style.display = 'none';
  };
  
  document.querySelector('.lightbox-close').onclick = close;
  lightbox.onclick = (e) => {
    if (e.target !== img && e.target !== cap) {
      close();
    }
  };
}

// Populate Form for Editing
function populateFormForEdit(log, photos) {
  resetForm();
  
  document.getElementById('edit-log-id').value = log.id;
  document.getElementById('form-date').value = log.date;
  document.getElementById('form-shift').value = log.shift;
  document.getElementById('form-is-number').value = log.isNumber;
  document.getElementById('form-supervisor').value = log.supervisor;
  document.getElementById('form-remarks').value = log.remarks || '';
  
  // Hydrate activities
  currentActivities = JSON.parse(JSON.stringify(log.activities));
  renderActivities();
  
  // Hydrate machines
  currentMachines = JSON.parse(JSON.stringify(log.machines));
  renderMachines();
  
  // Hydrate photos
  photos.forEach(photo => {
    const previewUrl = URL.createObjectURL(photo.blob);
    uploadedPhotos.push({
      id: Date.now() + Math.random().toString(36).substr(2, 5),
      blob: photo.blob,
      caption: photo.caption || '',
      previewUrl: previewUrl
    });
  });
  renderPhotoPreviews();
  
  document.getElementById('form-submit-btn').textContent = 'Update Work Log';
  
  triggerTabSwitch('new-entry-tab');
}



// Setup Utility Actions: CSV Export, JSON Backup, JSON Restore
function setupUtilityActions() {
  const actionsBtn = document.getElementById('actions-btn');
  const actionsDropdown = document.getElementById('actions-dropdown');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const backupBtn = document.getElementById('backup-btn');
  const restoreTrigger = document.getElementById('restore-trigger');
  const restoreInput = document.getElementById('restore-input');

  // Toggle Actions Dropdown
  actionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    actionsDropdown.parentElement.classList.toggle('active');
  });

  document.addEventListener('click', () => {
    actionsDropdown.parentElement.classList.remove('active');
  });

  // 1. Export CSV
  exportCsvBtn.addEventListener('click', () => {
    exportToCSV();
  });

  // 2. Backup Database
  backupBtn.addEventListener('click', async () => {
    try {
      showToast('Preparing backup file...');
      const data = await window.dbService.getBackupData();
      
      // Convert image Blobs to Base64 strings for JSON serialization
      const backupData = {
        logs: data.logs,
        photos: []
      };

      for (const photo of data.photos) {
        const base64 = await blobToBase64(photo.blob);
        backupData.photos.push({
          logId: photo.logId,
          base64: base64,
          caption: photo.caption,
          timestamp: photo.timestamp
        });
      }

      // Download JSON File
      const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Ops_Tracker_Database_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Database backup downloaded!');
    } catch (err) {
      console.error('Backup error:', err);
      showToast('Backup failed: ' + err.message, 'error');
    }
  });

  // 3. Restore Database
  restoreTrigger.addEventListener('click', () => {
    restoreInput.click();
  });

  restoreInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm('Warning: Importing a backup will overwrite all existing local data. Do you wish to proceed?')) {
      restoreInput.value = '';
      return;
    }

    showToast('Restoring database...');
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        
        // Convert Base64 strings back to Blobs
        const restoreData = {
          logs: backupData.logs || [],
          photos: []
        };

        if (backupData.photos) {
          for (const p of backupData.photos) {
            const blob = base64ToBlob(p.base64, 'image/jpeg');
            restoreData.photos.push({
              logId: Number(p.logId),
              blob: blob,
              caption: p.caption || '',
              timestamp: p.timestamp || Date.now()
            });
          }
        }

        await window.dbService.restoreBackup(restoreData);
        showToast('Database restored successfully!');
        restoreInput.value = '';
        await loadLogsAndRefresh();
        triggerTabSwitch('dashboard-tab');
      } catch (err) {
        console.error('Restore error:', err);
        showToast('Restore failed! Invalid backup file format.', 'error');
        restoreInput.value = '';
      }
    };
    reader.readAsText(file);
  });
}

// Convert Log Data to Excel-compatible CSV File
function exportToCSV() {
  const logsToExport = filteredLogs;
  if (logsToExport.length === 0) {
    showToast('No logs match the current filters to export.', 'error');
    return;
  }

  const csvRows = [];
  
  // Column Header row
  csvRows.push([
    'Log ID',
    'Date',
    'Shift',
    'IS Number',
    'Supervisor',
    'Activity Type',
    'Internal Labor Count',
    'Internal OT Hours',
    'Extra Labor Count',
    'Extra OT Hours',
    'Task Description / Output',
    'General Remarks / Delays'
  ].map(h => `"${h.replace(/"/g, '""')}"`).join(','));

  // Flatten logs into activity-level rows
  logsToExport.forEach(log => {
    if (log.activities && log.activities.length > 0) {
      log.activities.forEach(act => {
        csvRows.push([
          log.id,
          log.date,
          log.shift,
          log.isNumber,
          log.supervisor,
          act.type,
          act.internalCount || 0,
          act.internalOt || 0,
          act.extraCount || 0,
          act.extraOt || 0,
          act.notes || '',
          log.remarks || ''
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
      });
    } else {
      // Row fallback if there were no activities
      csvRows.push([
        log.id,
        log.date,
        log.shift,
        log.isNumber,
        log.supervisor,
        'None',
        0,
        0,
        0,
        0,
        '',
        log.remarks || ''
      ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
    }
  });

  // Trigger File Download
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  // Dynamic filename based on date filters
  const startVal = document.getElementById('filter-start-date').value;
  const endVal = document.getElementById('filter-end-date').value;
  let filename = 'Ops_Work_Tracker_Export';
  if (startVal && endVal) {
    filename += `_from_${startVal}_to_${endVal}`;
  } else if (startVal) {
    filename += `_since_${startVal}`;
  } else if (endVal) {
    filename += `_until_${endVal}`;
  } else {
    filename += `_All_${new Date().toISOString().split('T')[0]}`;
  }
  
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Excel report downloaded!');
}

// Image File Conversion Helpers
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

// Utilities: HTML Escaper & Date Formatter
function escapeHTML(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateString(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date)) return dateStr;
  
  const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}
