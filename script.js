// ---------- 1. Данные ----------
// Каждая задача: { id, title, deadline, note, status }
// status: "todo" | "progress" | "done"
const STORAGE_KEY = "umzug-tracker-tasks";
let query = "";          // текст поиска
let filter = "all";      // фильтр по статусу
let editingId = null;    // id дела, которое сейчас редактируем
let pendingDocs = [];    // документы для чек-листа нового или редактируемого дела
const noMatch = document.getElementById("no-match");
const editBanner = document.getElementById("edit-banner");
let tasks = loadTasks();
let expandedId = null; // какая карточка сейчас раскрыта
let fx = {};           // эффекты для следующей отрисовки: { added, popped, expanded }

function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return []; // если в хранилище мусор, начинаем с пустого списка
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// ---------- 2. Элементы страницы ----------
const form = document.getElementById("task-form");
const titleInput = document.getElementById("title");
const deadlineInput = document.getElementById("deadline");
const noteInput = document.getElementById("note");
const details = document.getElementById("details");
const detailsToggle = document.getElementById("details-toggle");
const sendBtn = document.getElementById("send-btn");
const list = document.getElementById("task-list");
const emptyMessage = document.getElementById("empty");
const summary = document.getElementById("summary");
const progressBar = document.getElementById("progress-bar");

const STATUS_LABELS = {
  todo: "Не начато",
  progress: "В процессе",
  done: "Готово",
};

// Цвета аватаров (градиенты как в Telegram)
const AVATAR_GRADIENTS = [
  ["#ff885e", "#ff516a"],
  ["#ffcd6a", "#ffa85c"],
  ["#82b1ff", "#665fff"],
  ["#a0de7e", "#54cb68"],
  ["#53edd6", "#28c9b7"],
  ["#72d5fd", "#2a9ef1"],
  ["#e0a2f3", "#d669ed"],
];

const CHECK_ICON =
  '<svg class="check" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" ' +
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// Идущий человечек: ноги и руки качаются благодаря CSS-анимации (.walker в style.css)
const WALK_ICON =
  '<svg class="walker" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<g class="walker-body">' +
  '<circle cx="13" cy="4" r="2" fill="#fff" stroke="none"/>' +
  '<path class="limb arm arm-b" d="M12.6 9V14"/>' +
  '<path class="limb leg leg-b" d="M11.6 14v6.5"/>' +
  '<path d="M12.8 7.6L11.6 14"/>' +
  '<path class="limb leg leg-a" d="M11.6 14v6.5"/>' +
  '<path class="limb arm arm-a" d="M12.6 9V14"/>' +
  '</g></svg>';

const PROGRESS_GRADIENT = "linear-gradient(135deg, #5ab8f5, #3390ec)";

// ---------- 3. Логика дедлайнов ----------
const SOON_DAYS = 7; // "скоро" = меньше недели

function daysUntil(dateString) {
  if (!dateString) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateString);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000); // 86400000 мс = 1 день
}

function urgencyClass(task) {
  if (task.status === "done") return "done";
  const days = daysUntil(task.deadline);
  if (days === null) return "";
  if (days < 0) return "overdue";
  if (days <= SOON_DAYS) return "soon";
  return "";
}

function formatShortDate(task) {
  if (!task.deadline) return "";
  return new Date(task.deadline).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

// Что показать в цветном бейдже справа
function badgeFor(task) {
  if (task.status === "done") return null;
  const urgency = urgencyClass(task);
  const days = daysUntil(task.deadline);
  if (urgency === "overdue") return { text: "Просрочено", color: "red" };
  if (urgency === "soon") {
    return { text: days === 0 ? "Сегодня" : `${days} дн.`, color: "orange" };
  }
  if (task.status === "progress") return { text: "В процессе", color: "blue" };
  return null;
}

// Цвет аватара зависит от названия, поэтому у одного дела он всегда одинаковый
function gradientFor(title) {
  let sum = 0;
  for (const ch of title) sum += ch.codePointAt(0);
  const [from, to] = AVATAR_GRADIENTS[sum % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

// ---------- 4. Отрисовка ----------
function render() {
  list.innerHTML = ""; // очищаем список и рисуем заново

  // Сортировка: сначала невыполненные, по ближайшему дедлайну
  const sorted = tasks.filter(matchesFilter).sort((a, b) => {
    if ((a.status === "done") !== (b.status === "done")) {
      return a.status === "done" ? 1 : -1;
    }
    return (a.deadline || "9999").localeCompare(b.deadline || "9999");
  });

  for (const task of sorted) {
    list.appendChild(createTaskElement(task));
  }

  emptyMessage.hidden = tasks.length > 0;
  noMatch.hidden = !(tasks.length > 0 && sorted.length === 0);

  const doneCount = tasks.filter((t) => t.status === "done").length;
  summary.textContent = tasks.length
    ? `Выполнено ${doneCount} из ${tasks.length}`
    : "Список пуст";
  progressBar.style.width = tasks.length
    ? `${(doneCount / tasks.length) * 100}%`
    : "0";

  fx = {}; // каждый эффект проигрывается один раз
}

function createTaskElement(task) {
  const isExpanded = task.id === expandedId;
  const li = document.createElement("li");
  li.className = `task ${urgencyClass(task)}${isExpanded ? " expanded" : ""}` +
    (task.id === fx.added ? " enter-row" : "");

  // Используем textContent, а не innerHTML для текста пользователя:
  // так он не сможет внедрить чужой HTML или скрипт (защита от XSS).
  // innerHTML ниже используется только для нашей собственной иконки.
  const row = document.createElement("div");
  row.className = "task-row";

  // Аватар: нажатие = выполнено / не выполнено
  const avatar = document.createElement("button");
  avatar.type = "button";
  avatar.className = "avatar";
  avatar.style.background = gradientFor(task.title);
  avatar.setAttribute(
    "aria-label",
    task.status === "done" ? "Вернуть в работу" : "Отметить выполненным"
  );
  if (task.status === "done") {
    avatar.innerHTML = CHECK_ICON;
  } else if (task.status === "progress") {
    avatar.innerHTML = WALK_ICON;                 // идущий человечек
    avatar.style.background = PROGRESS_GRADIENT;
  } else {
    avatar.textContent = ([...task.title.trim()][0] || "?").toUpperCase();
  }
  if (task.id === fx.popped) avatar.classList.add("pop");
  avatar.addEventListener("click", () =>
    changeStatus(task.id, task.status === "done" ? "todo" : "done")
  );

  // Основная часть: нажатие раскрывает карточку
  const main = document.createElement("button");
  main.type = "button";
  main.className = "task-main";
  main.setAttribute("aria-expanded", String(isExpanded));
  main.addEventListener("click", () => toggleExpanded(task.id));

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;

  const date = document.createElement("span");
  date.className = "task-date";
  date.textContent = formatShortDate(task);

  const sub = document.createElement("span");
  sub.className = "task-sub";
  sub.textContent = task.note || STATUS_LABELS[task.status];

  main.append(title, date, sub);

  const badgeInfo = badgeFor(task);
  if (badgeInfo) {
    const badge = document.createElement("span");
    badge.className = `badge ${badgeInfo.color}`;
    badge.textContent = badgeInfo.text;
    main.appendChild(badge);
  }

  row.append(avatar, main);
  li.appendChild(row);

  if (isExpanded) li.appendChild(createPanel(task));
  return li;
}

// Панель с выбором статуса и удалением
function createPanel(task) {
  const panel = document.createElement("div");
  panel.className = "task-panel" + (task.id === fx.expanded ? " enter" : "");

  const segmented = document.createElement("div");
  segmented.className = "segmented";
  segmented.setAttribute("role", "group");
  segmented.setAttribute("aria-label", "Статус");

  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(task.status === value));
    btn.addEventListener("click", () => changeStatus(task.id, value));
    segmented.appendChild(btn);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = "Удалить";
  del.addEventListener("click", () => deleteTask(task.id));

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit";
  edit.textContent = "Изменить";
  edit.addEventListener("click", () => startEdit(task.id));

  panel.append(segmented);
  if (task.docs && task.docs.length) panel.append(createChecklist(task));
  panel.append(edit, del);
  return panel;
}

// ---------- 5. Действия ----------
function addTask(title, deadline, note, docs = []) {
  const id = Date.now();     // простой уникальный номер
  fx.added = id;             // карточка плавно появится
  tasks.push({
    id,
    title: title.trim(),
    deadline,
    note: note.trim(),
    status: "todo",
    docs: docs.map((text) => ({ text, done: false })),
  });
  saveTasks();
  render();
}

function changeStatus(id, status) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    if (task.status !== status) fx.popped = id; // иконка "подпрыгнет"
    task.status = status;
  }
  saveTasks();
  render();
}

function deleteTask(id) {
  const index = tasks.findIndex((t) => t.id === id);
  const removed = tasks[index];
  tasks = tasks.filter((t) => t.id !== id);
  if (removed) {
    showToast("Дело удалено", "Отменить", () => {
      tasks.splice(index, 0, removed); // возвращаем на прежнее место
      saveTasks();
      render();
    });
  }
  if (expandedId === id) expandedId = null;
  saveTasks();
  render();
}

function toggleExpanded(id) {
  expandedId = expandedId === id ? null : id;
  if (expandedId === id) fx.expanded = id; // панель плавно выезжает
  render();
}

// ---------- 6. Панель ввода ----------
function setDetailsOpen(open) {
  details.hidden = !open;
  detailsToggle.setAttribute("aria-expanded", String(open));
}

function updateSendButton() {
  sendBtn.disabled = titleInput.value.trim() === "";
}

detailsToggle.addEventListener("click", () => setDetailsOpen(details.hidden));
titleInput.addEventListener("input", updateSendButton);

form.addEventListener("submit", (event) => {
  event.preventDefault(); // не перезагружать страницу
  if (titleInput.value.trim() === "") return;

  if (editingId) saveEdit();
  else addTask(titleInput.value, deadlineInput.value, noteInput.value, pendingDocs);
  pendingDocs = [];
  editingId = null;
  editBanner.hidden = true;
  form.reset();
  setDetailsOpen(false);
  updateSendButton();
  titleInput.focus(); // можно сразу писать следующее дело
});

// ---------- 7. Старт ----------
render();

// ---------- 8. Подсказки: что взять с собой в ведомство ----------
// Дополнительная возможность: выбираете ведомство в списке,
// и перечень документов подставляется в поле "Заметка".
// Это ориентировочные списки: требования зависят от города и земли.
const AMT_GUIDES = [
  {
    group: "Основные ведомства",
    items: [
      {
        id: "anmeldung",
        label: "Einwohnermeldeamt (Anmeldung)",
        docs: [
          "паспорт или удостоверение личности",
          "Wohnungsgeberbestätigung (подтверждение от арендодателя)",
          "заполненный бланк Anmeldung",
          "договор аренды (если попросят)",
          "свидетельства о браке и рождении детей (если переезжаете с семьёй)",
        ],
        tip: "Срок: 14 дней после заселения.",
      },
      {
        id: "auslaender",
        label: "Ausländerbehörde (вид на жительство)",
        docs: [
          "паспорт и виза",
          "Anmeldebestätigung",
          "биометрическое фото",
          "договор аренды",
          "подтверждение медстраховки",
          "трудовой договор, Immatrikulationsbescheinigung или подтверждение средств",
          "заполненное заявление",
          "деньги на пошлину",
        ],
        tip: "Запишитесь на приём заранее. Гражданам ЕС обычно не нужно.",
      },
      {
        id: "finanzamt",
        label: "Finanzamt (налоги)",
        docs: [
          "Steuer-ID приходит по почте сама после Anmeldung, в течение нескольких недель",
          "самозанятым: Fragebogen zur steuerlichen Erfassung (через ELSTER)",
          "Gewerbeanmeldung, если есть",
          "паспорт и Anmeldebestätigung",
        ],
        tip: "Steuer-ID нужен работодателю.",
      },
      {
        id: "krankenkasse",
        label: "Krankenkasse (медстраховка)",
        docs: [
          "паспорт",
          "Anmeldebestätigung",
          "трудовой договор или Immatrikulationsbescheinigung",
          "справка о страховании из прежней страны или EHIC",
          "Sozialversicherungsnummer, если уже есть",
          "IBAN",
        ],
        tip: "Страховка в Германии обязательна.",
      },
      {
        id: "arbeitsagentur",
        label: "Agentur für Arbeit (поиск работы)",
        docs: [
          "паспорт",
          "Aufenthaltstitel (для не-граждан ЕС)",
          "Anmeldebestätigung",
          "резюме",
          "дипломы и справки с прошлой работы",
          "Steuer-ID и IBAN",
        ],
        tip: "Регистрируйтесь как arbeitsuchend как можно раньше.",
      },
      {
        id: "jobcenter",
        label: "Jobcenter (Bürgergeld)",
        docs: [
          "паспорт",
          "Aufenthaltstitel",
          "Anmeldebestätigung",
          "договор аренды",
          "выписки со счёта за последние 3 месяца",
          "подтверждение дохода и имущества",
          "подтверждение медстраховки",
        ],
        tip: "Право на пособие зависит от статуса пребывания.",
      },
      {
        id: "familienkasse",
        label: "Familienkasse (Kindergeld)",
        docs: [
          "заполненное заявление Antrag auf Kindergeld",
          "Steuer-ID родителей и детей",
          "свидетельства о рождении детей",
          "Anmeldebestätigung",
          "Aufenthaltstitel (если требуется)",
          "IBAN",
        ],
        tip: "Подавайте как можно раньше: выплата задним числом ограничена по времени.",
      },
      {
        id: "standesamt",
        label: "Standesamt (брак, рождение)",
        docs: [
          "паспорта",
          "свидетельство о рождении (часто с апостилем)",
          "справка о семейном статусе, Ehefähigkeitszeugnis или документ о разводе",
          "Meldebescheinigung",
          "заверенный перевод документов",
        ],
        tip: "Переводы делает присяжный переводчик (beeidigter Übersetzer).",
      },
      {
        id: "fuehrerschein",
        label: "Führerscheinstelle (водительские права)",
        docs: [
          "паспорт",
          "Anmeldebestätigung",
          "оригинал прав и заверенный перевод",
          "биометрическое фото",
          "Sehtest (проверка зрения)",
          "заполненное заявление",
        ],
        tip: "Права не из ЕС обычно действуют только 6 месяцев после Anmeldung.",
      },
      {
        id: "kfz",
        label: "Kfz-Zulassungsstelle (автомобиль)",
        docs: [
          "паспорт и Meldebescheinigung",
          "Zulassungsbescheinigung Teil I и II (документы на авто)",
          "eVB-номер от страховой",
          "SEPA-мандат на налог на авто",
          "отчёт TÜV (Hauptuntersuchung)",
          "деньги на пошлину и номерные знаки",
        ],
        tip: "Сначала оформите страховку, потом регистрацию.",
      },
    ],
  },
  {
    group: "Дополнительно",
    items: [
      {
        id: "bank",
        label: "Bank (Girokonto)",
        docs: [
          "паспорт",
          "Anmeldebestätigung",
          "Aufenthaltstitel (для не-граждан ЕС)",
          "трудовой договор или подтверждение учёбы (иногда)",
          "Steuer-ID (иногда)",
        ],
        tip: "Многие онлайн-банки открывают счёт по видеоидентификации.",
      },
      {
        id: "rundfunk",
        label: "Beitragsservice (Rundfunkbeitrag)",
        docs: [
          "адрес квартиры",
          "дата заселения",
          "IBAN для списания",
          "Beitragsnummer, если пришло письмо",
        ],
        tip: "Платится за квартиру, а не за человека.",
      },
      {
        id: "schule",
        label: "Schule / Kita (дети)",
        docs: [
          "свидетельство о рождении ребёнка",
          "паспорта родителей",
          "Anmeldebestätigung",
          "Impfausweis с подтверждением прививки от кори (Masern)",
          "последние табели (Zeugnisse) с переводом",
        ],
        tip: "Места в Kita лучше искать заранее.",
      },
    ],
  },
];

const amtSelect = document.getElementById("amt-select");

// flatMap склеивает списки всех групп в один плоский массив
const ALL_GUIDES = AMT_GUIDES.flatMap((section) => section.items);

// Заполняем выпадающий список: группы (optgroup) и пункты (option)
for (const section of AMT_GUIDES) {
  const group = document.createElement("optgroup");
  group.label = section.group;
  for (const item of section.items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    group.appendChild(option);
  }
  amtSelect.appendChild(group);
}

// При выборе ведомства подставляем текст в заметку
amtSelect.addEventListener("change", () => {
  const guide = ALL_GUIDES.find((g) => g.id === amtSelect.value);
  if (!guide) return;

  const text = `${guide.label}: ${guide.tip}`;
  pendingDocs.push(...guide.docs.filter((d) => !pendingDocs.includes(d)));
  showToast(`В чек-лист добавлено документов: ${guide.docs.length}`);
  const current = noteInput.value.trim();
  // Если в заметке уже что-то есть, добавляем к ней через " | "
  noteInput.value = current ? `${current} | ${text}` : text;

  amtSelect.value = ""; // сбрасываем выбор, чтобы можно было добавить ещё одно ведомство
});

// ---------- 9. Эффект волны при нажатии на кнопки ----------
// Слушаем нажатия на всём документе (делегирование событий):
// один обработчик работает для всех кнопок, даже тех, что создаются позже.
document.addEventListener("pointerdown", (event) => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const button = event.target.closest("button:not(:disabled)");
  if (!button) return;

  // Для строки списка волна идёт по всей карточке, а не только по тексту
  const host = button.classList.contains("task-main")
    ? button.closest(".task-row")
    : button;

  const rect = host.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;

  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;

  host.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
});

// ---------- 10. Поиск и фильтр по статусу ----------
function matchesFilter(task) {
  const q = query.trim().toLowerCase();
  const textOk = !q || `${task.title} ${task.note}`.toLowerCase().includes(q);
  return textOk && (filter === "all" || task.status === filter);
}

document.getElementById("search").addEventListener("input", (event) => {
  query = event.target.value;
  render();
});

document.getElementById("filters").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-filter]");
  if (!btn) return;
  filter = btn.dataset.filter;
  for (const b of event.currentTarget.children) {
    b.setAttribute("aria-pressed", String(b === btn));
  }
  render();
});

// ---------- 11. Редактирование дела ----------
function startEdit(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  editingId = id;
  titleInput.value = task.title;
  deadlineInput.value = task.deadline || "";
  noteInput.value = task.note || "";
  pendingDocs = (task.docs || []).map((d) => d.text);
  editBanner.hidden = false;
  setDetailsOpen(true);
  updateSendButton();
  titleInput.focus();
}

function saveEdit() {
  const task = tasks.find((t) => t.id === editingId);
  if (!task) return;
  const doneByText = new Map((task.docs || []).map((d) => [d.text, d.done]));
  task.title = titleInput.value.trim();
  task.deadline = deadlineInput.value;
  task.note = noteInput.value.trim();
  task.docs = pendingDocs.map((text) => ({ text, done: doneByText.get(text) || false }));
  saveTasks();
  render();
  showToast("Изменения сохранены");
}

document.getElementById("edit-cancel").addEventListener("click", () => {
  editingId = null;
  pendingDocs = [];
  editBanner.hidden = true;
  form.reset();
  setDetailsOpen(false);
  updateSendButton();
});

// ---------- 12. Чек-лист документов внутри дела ----------
function createChecklist(task) {
  const box = document.createElement("div");
  box.className = "checklist";

  const head = document.createElement("div");
  head.className = "checklist-head";
  head.textContent = `Документы: ${task.docs.filter((d) => d.done).length} из ${task.docs.length}`;
  box.append(head);

  for (const doc of task.docs) {
    const label = document.createElement("label");
    const box1 = document.createElement("input");
    box1.type = "checkbox";
    box1.checked = doc.done;
    box1.addEventListener("change", () => {
      doc.done = box1.checked;
      saveTasks();
      render();
    });
    const text = document.createElement("span");
    text.textContent = doc.text;
    label.append(box1, text);
    box.append(label);
  }
  return box;
}

// ---------- 13. Уведомление (с кнопкой "Отменить") ----------
let toastTimer;
function showToast(text, actionLabel, onAction) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.replaceChildren();
  const span = document.createElement("span");
  span.textContent = text;
  toast.append(span);
  if (actionLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      onAction();
      toast.classList.remove("show");
    });
    toast.append(btn);
  }
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 5000);
}

// ---------- 14. Шаблон "Первые 3 месяца в Германии" ----------
// [название, id подсказки из блока 8, через сколько дней дедлайн]
const TEMPLATE_3_MONTHS = [
  ["Krankenkasse", "krankenkasse", 7],
  ["Girokonto", "bank", 10],
  ["Anmeldung", "anmeldung", 14],
  ["Aufenthaltstitel", "auslaender", 30],
  ["Steuer-ID (проверить почту)", "finanzamt", 30],
  ["Rundfunkbeitrag", "rundfunk", 45],
  ["Kindergeld", "familienkasse", 60],
  ["Führerschein umschreiben", "fuehrerschein", 90],
];

function addTemplate() {
  const existing = new Set(tasks.map((t) => t.title.toLowerCase()));
  let added = 0;
  TEMPLATE_3_MONTHS.forEach(([title, guideId, days], i) => {
    if (existing.has(title.toLowerCase())) return; // не дублируем
    const guide = ALL_GUIDES.find((g) => g.id === guideId);
    const due = new Date();
    due.setDate(due.getDate() + days);
    tasks.push({
      id: Date.now() + i,
      title,
      deadline: due.toLocaleDateString("sv-SE"), // формат ГГГГ-ММ-ДД
      note: `${guide.label}: ${guide.tip}`,
      status: "todo",
      docs: guide.docs.map((text) => ({ text, done: false })),
    });
    added++;
  });
  saveTasks();
  render();
  showToast(added ? `Добавлено дел: ${added}` : "Все дела из шаблона уже в списке");
}

document.querySelectorAll(".js-template").forEach((b) => b.addEventListener("click", addTemplate));

// ---------- 15. Экспорт и импорт JSON ----------
const importFile = document.getElementById("import-file");

document.getElementById("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `umzug-tracker-${new Date().toLocaleDateString("sv-SE")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

document.getElementById("import-btn").addEventListener("click", () => importFile.click());

// Файлу доверять нельзя: проверяем и очищаем каждое поле
function cleanTask(raw, i) {
  if (!raw || typeof raw.title !== "string" || !raw.title.trim()) return null;
  return {
    id: Number.isFinite(raw.id) ? raw.id : Date.now() + i,
    title: raw.title.trim().slice(0, 200),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline) ? raw.deadline : "",
    note: typeof raw.note === "string" ? raw.note.slice(0, 2000) : "",
    status: STATUS_LABELS[raw.status] ? raw.status : "todo",
    docs: Array.isArray(raw.docs)
      ? raw.docs
          .filter((d) => d && typeof d.text === "string")
          .map((d) => ({ text: d.text.slice(0, 300), done: d.done === true }))
      : [],
  };
}

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = ""; // чтобы можно было выбрать тот же файл повторно
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const clean = (Array.isArray(data) ? data : []).map(cleanTask).filter(Boolean);
    if (!clean.length) throw new Error("нет дел");
    const byId = new Map(tasks.map((t) => [t.id, t])); // совпадающие id заменяются
    clean.forEach((t) => byId.set(t.id, t));
    tasks = [...byId.values()];
    saveTasks();
    render();
    showToast(`Импортировано дел: ${clean.length}`);
  } catch {
    showToast("Не удалось прочитать файл");
  }
});
