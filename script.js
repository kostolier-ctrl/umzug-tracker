// ---------- 1. Данные ----------
// Каждая задача: { id, title, deadline, note, status }
// status: "todo" | "progress" | "done"
const STORAGE_KEY = "umzug-tracker-tasks";
const LANG_KEY = "umzug-tracker-lang";
let lang = safeGet(LANG_KEY) || (navigator.language.startsWith("de") ? "de" : "ru");
const T = (ru, de) => (lang === "de" ? de : ru); // выбор текста по языку
const STATUS_DE = { todo: "Offen", progress: "In Arbeit", done: "Erledigt" };
const statusLabel = (key) => T(STATUS_LABELS[key], STATUS_DE[key]);
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // память браузера переполнена или отключена (например, приватный режим)
    if (!saveWarned) {
      saveWarned = true;
      showToast(T("Не удалось сохранить данные. Сделайте экспорт в файл.", "Speichern fehlgeschlagen. Exportiere deine Daten als Datei."));
    }
  }
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
  const due = parseLocalDate(dateString);
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
  return parseLocalDate(task.deadline).toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU", {
    day: "numeric",
    month: "short",
  });
}

// Что показать в цветном бейдже справа
function badgeFor(task) {
  if (task.status === "done") return null;
  const urgency = urgencyClass(task);
  const days = daysUntil(task.deadline);
  if (urgency === "overdue") return { text: T("Просрочено", "Überfällig"), color: "red" };
  if (urgency === "soon") {
    return { text: days === 0 ? T("Сегодня", "Heute") : T(`${days} дн.`, `${days} Tg.`), color: "orange" };
  }
  if (task.status === "progress") return { text: T("В процессе", "In Arbeit"), color: "blue" };
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
  document.getElementById("clear-btn").disabled = tasks.length === 0;

  const doneCount = tasks.filter((t) => t.status === "done").length;
  summary.textContent = tasks.length
    ? T(`Выполнено ${doneCount} из ${tasks.length}`, `${doneCount} von ${tasks.length} erledigt`)
    : T("Список пуст", "Liste ist leer");
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
    task.status === "done" ? T("Вернуть в работу", "Wieder öffnen") : T("Отметить выполненным", "Als erledigt markieren")
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
  sub.textContent = task.note || tipsOf(task) || statusLabel(task.status);

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
  segmented.setAttribute("aria-label", T("Статус", "Status"));

  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = statusLabel(value);
    btn.setAttribute("aria-pressed", String(task.status === value));
    btn.addEventListener("click", () => changeStatus(task.id, value));
    segmented.appendChild(btn);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete";
  del.textContent = T("Удалить", "Löschen");
  del.addEventListener("click", () => deleteTask(task.id));

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit";
  edit.textContent = T("Изменить", "Bearbeiten");
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
    showToast(T("Дело удалено", "Aufgabe gelöscht"), T("Отменить", "Rückgängig"), () => {
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
// Первая отрисовка делается в конце файла, в applyLanguage().

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


// При выборе ведомства подставляем текст в заметку
amtSelect.addEventListener("change", () => {
  const guide = ALL_GUIDES.find((g) => g.id === amtSelect.value);
  if (!guide) return;

  // В чек-лист кладём ссылки на документы (id:номер), а не готовый текст: так он переводится
  const keys = guide.docs.map((_, i) => `${guide.id}:${i}`);
  pendingDocs.push(...keys.filter((k) => !pendingDocs.includes(k)));
  showToast(T(`В чек-лист добавлено документов: ${guide.docs.length}`, `Unterlagen zur Checkliste hinzugefügt: ${guide.docs.length}`));

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
  showToast(T("Изменения сохранены", "Änderungen gespeichert"));
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
  const doneDocs = task.docs.filter((d) => d.done).length;
  head.textContent = T(`Документы: ${doneDocs} из ${task.docs.length}`, `Unterlagen: ${doneDocs} von ${task.docs.length}`);
  box.append(head);

  for (const g of guidesOf(task)) {
    const info = document.createElement("div");
    info.className = "checklist-tip";
    info.append(`${guideLabel(g)}: ${guideTip(g)} `);
    const link = document.createElement("a");
    link.href = GUIDE_URLS[g.id];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = T("Официальный сайт", "Offizielle Website");
    info.append(link, ` · ${T(`Данные на ${GUIDES_UPDATED}`, `Stand: ${GUIDES_UPDATED}`)}`);
    box.append(info);
  }

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
    text.textContent = docLabel(doc.text);
    label.append(box1, text);
    box.append(label);
  }
  return box;
}

// ---------- 13. Уведомление (с кнопкой "Отменить") ----------
function showToast(text, actionLabel, onAction) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.setAttribute("role", "status");
    document.body.appendChild(box);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  const span = document.createElement("span");
  span.textContent = text;
  toast.append(span);
  if (actionLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => { onAction(); toast.remove(); });
    toast.append(btn);
  }
  box.append(toast);
  while (box.children.length > 3) box.firstElementChild.remove(); // не больше трёх сразу
  setTimeout(() => toast.remove(), actionLabel ? 6000 : 4000);
}

// ---------- 14. Шаблон "Первые 3 месяца в Германии" ----------
// [название, id подсказки из блока 8, через сколько дней дедлайн]
const TEMPLATE_3_MONTHS = [
  ["Krankenkasse", "krankenkasse", 7],
  ["Girokonto", "bank", 10],
  ["Anmeldung", "anmeldung", 14],
  ["Aufenthaltstitel", "auslaender", 30],
  ["Steuer-ID", "finanzamt", 30],
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
      note: "",
      status: "todo",
      docs: guide.docs.map((_, i) => ({ text: `${guide.id}:${i}`, done: false })),
    });
    added++;
  });
  saveTasks();
  render();
  showToast(added ? T(`Добавлено дел: ${added}`, `Aufgaben hinzugefügt: ${added}`) : T("Все дела из шаблона уже в списке", "Alle Aufgaben der Vorlage sind schon in der Liste"));
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
  safeSet(EXPORT_KEY, String(Date.now())); // для напоминания о резервной копии
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
    const clean = (Array.isArray(data) ? data : []).map(cleanTask).filter(Boolean).map(migrateTask);
    if (!clean.length) throw new Error("нет дел");
    const byId = new Map(tasks.map((t) => [t.id, t])); // совпадающие id заменяются
    clean.forEach((t) => byId.set(t.id, t));
    tasks = [...byId.values()];
    saveTasks();
    render();
    showToast(T(`Импортировано дел: ${clean.length}`, `Aufgaben importiert: ${clean.length}`));
  } catch {
    showToast(T("Не удалось прочитать файл", "Datei konnte nicht gelesen werden"));
  }
});

// ---------- 16. Меню "+" в шапке ----------
const menuBtn = document.getElementById("menu-btn");
const menu = document.getElementById("menu");

function setMenuOpen(open, returnFocus = false) {
  menu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  if (!open && returnFocus) menuBtn.focus(); // фокус возвращается на кнопку
}

menuBtn.addEventListener("click", (event) => {
  setMenuOpen(menu.hidden);
  if (!menu.hidden && event.detail === 0) menu.querySelector("button").focus(); // открыли с клавиатуры
});
menu.addEventListener("click", (event) => {
  if (event.target.closest("button")) setMenuOpen(false, true); // выбрали пункт, меню закрылось
});
document.addEventListener("pointerdown", (event) => {
  if (!menu.hidden && !event.target.closest("#menu, #menu-btn")) setMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menu.hidden) setMenuOpen(false, true);
});

// ---------- 16б. Подсказки на двух языках ----------
// Дела хранят только ссылки вида "anmeldung:0" (ведомство:номер документа).
// Текст берётся из данных на нужном языке, поэтому переключение RU/DE переводит всё.
var saveWarned = false;
const REF_RE = /^([a-z]+):(\d+)$/;
const GUIDES_UPDATED = "11/2026";   // обновляйте после проверки списков на сайтах ведомств
const GROUP_DE = { "Основные ведомства": "Wichtigste Behörden", "Дополнительно": "Weitere" };
const GUIDE_URLS = {
  anmeldung: "https://verwaltung.bund.de", auslaender: "https://www.make-it-in-germany.com",
  finanzamt: "https://www.bzst.de", krankenkasse: "https://www.gkv-spitzenverband.de",
  arbeitsagentur: "https://www.arbeitsagentur.de", jobcenter: "https://www.arbeitsagentur.de",
  familienkasse: "https://www.arbeitsagentur.de", standesamt: "https://verwaltung.bund.de",
  fuehrerschein: "https://www.kba.de", kfz: "https://www.kba.de", bank: "https://www.bafin.de",
  rundfunk: "https://www.rundfunkbeitrag.de", schule: "https://www.kmk.org",
};
// Порядок документов совпадает с русскими списками в AMT_GUIDES
const GUIDES_DE = {
  anmeldung: { label: "Einwohnermeldeamt (Anmeldung)", tip: "Frist: 14 Tage nach dem Einzug.",
    docs: ["Reisepass oder Personalausweis", "Wohnungsgeberbestätigung (vom Vermieter)", "ausgefülltes Anmeldeformular", "Mietvertrag (falls verlangt)", "Heirats- und Geburtsurkunden der Kinder (bei Umzug mit Familie)"] },
  auslaender: { label: "Ausländerbehörde (Aufenthaltstitel)", tip: "Termin früh buchen. EU-Bürger brauchen meist keinen.",
    docs: ["Reisepass und Visum", "Anmeldebestätigung", "biometrisches Passfoto", "Mietvertrag", "Nachweis der Krankenversicherung", "Arbeitsvertrag, Immatrikulationsbescheinigung oder Nachweis der Mittel", "ausgefüllter Antrag", "Geld für die Gebühr"] },
  finanzamt: { label: "Finanzamt (Steuern)", tip: "Die Steuer-ID braucht dein Arbeitgeber.",
    docs: ["Die Steuer-ID kommt nach der Anmeldung automatisch per Post, innerhalb weniger Wochen", "Selbstständige: Fragebogen zur steuerlichen Erfassung (über ELSTER)", "Gewerbeanmeldung, falls vorhanden", "Reisepass und Anmeldebestätigung"] },
  krankenkasse: { label: "Krankenkasse (Krankenversicherung)", tip: "Krankenversicherung ist in Deutschland Pflicht.",
    docs: ["Reisepass", "Anmeldebestätigung", "Arbeitsvertrag oder Immatrikulationsbescheinigung", "Versicherungsnachweis aus dem Herkunftsland oder EHIC", "Sozialversicherungsnummer, falls schon vorhanden", "IBAN"] },
  arbeitsagentur: { label: "Agentur für Arbeit (Jobsuche)", tip: "Melde dich so früh wie möglich arbeitsuchend.",
    docs: ["Reisepass", "Aufenthaltstitel (für Nicht-EU-Bürger)", "Anmeldebestätigung", "Lebenslauf", "Zeugnisse und Arbeitszeugnisse", "Steuer-ID und IBAN"] },
  jobcenter: { label: "Jobcenter (Bürgergeld)", tip: "Der Anspruch hängt vom Aufenthaltsstatus ab.",
    docs: ["Reisepass", "Aufenthaltstitel", "Anmeldebestätigung", "Mietvertrag", "Kontoauszüge der letzten 3 Monate", "Nachweis über Einkommen und Vermögen", "Nachweis der Krankenversicherung"] },
  familienkasse: { label: "Familienkasse (Kindergeld)", tip: "Früh beantragen: rückwirkend wird nur begrenzt gezahlt.",
    docs: ["ausgefüllter Antrag auf Kindergeld", "Steuer-ID der Eltern und Kinder", "Geburtsurkunden der Kinder", "Anmeldebestätigung", "Aufenthaltstitel (falls erforderlich)", "IBAN"] },
  standesamt: { label: "Standesamt (Heirat, Geburt)", tip: "Übersetzungen macht ein beeidigter Übersetzer.",
    docs: ["Reisepässe", "Geburtsurkunde (oft mit Apostille)", "Ehefähigkeitszeugnis, Ledigkeitsbescheinigung oder Scheidungsurteil", "Meldebescheinigung", "beglaubigte Übersetzung der Dokumente"] },
  fuehrerschein: { label: "Führerscheinstelle (Führerschein)", tip: "Führerscheine aus Nicht-EU-Ländern gelten meist nur 6 Monate nach der Anmeldung.",
    docs: ["Reisepass", "Anmeldebestätigung", "Original-Führerschein und beglaubigte Übersetzung", "biometrisches Passfoto", "Sehtest", "ausgefüllter Antrag"] },
  kfz: { label: "Kfz-Zulassungsstelle (Auto)", tip: "Erst die Versicherung abschließen, dann zulassen.",
    docs: ["Reisepass und Meldebescheinigung", "Zulassungsbescheinigung Teil I und II", "eVB-Nummer der Versicherung", "SEPA-Mandat für die Kfz-Steuer", "TÜV-Bericht (Hauptuntersuchung)", "Geld für Gebühr und Kennzeichen"] },
  bank: { label: "Bank (Girokonto)", tip: "Viele Online-Banken eröffnen Konten per Videoident.",
    docs: ["Reisepass", "Anmeldebestätigung", "Aufenthaltstitel (für Nicht-EU-Bürger)", "Arbeitsvertrag oder Studiennachweis (manchmal)", "Steuer-ID (manchmal)"] },
  rundfunk: { label: "Beitragsservice (Rundfunkbeitrag)", tip: "Der Beitrag gilt pro Wohnung, nicht pro Person.",
    docs: ["Adresse der Wohnung", "Einzugsdatum", "IBAN für den Einzug", "Beitragsnummer, falls ein Brief kam"] },
  schule: { label: "Schule / Kita (Kinder)", tip: "Kita-Plätze früh suchen.",
    docs: ["Geburtsurkunde des Kindes", "Reisepässe der Eltern", "Anmeldebestätigung", "Impfausweis mit Masernnachweis", "letzte Zeugnisse mit Übersetzung"] },
};

const guideLabel = (g) => (lang === "de" ? GUIDES_DE[g.id].label : g.label);
const guideTip = (g) => (lang === "de" ? GUIDES_DE[g.id].tip : g.tip);
const guideDocs = (g) => (lang === "de" ? GUIDES_DE[g.id].docs : g.docs);

// "anmeldung:0" → текст документа на текущем языке; обычный текст остаётся как есть
function docLabel(key) {
  const m = REF_RE.exec(key);
  const g = m && ALL_GUIDES.find((x) => x.id === m[1]);
  return (g && guideDocs(g)[Number(m[2])]) || key;
}

// Ведомства, на которые ссылаются документы дела
function guidesOf(task) {
  const ids = [];
  for (const d of task.docs || []) {
    const m = REF_RE.exec(d.text);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids.map((id) => ALL_GUIDES.find((g) => g.id === id)).filter(Boolean);
}
const tipsOf = (task) => guidesOf(task).map(guideTip).join(" | ");

// Дата ГГГГ-ММ-ДД как местная (new Date("2026-11-07") читает её как UTC и в США сдвигает на день)
function parseLocalDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Старые данные (русский текст внутри дел) превращаем в ссылки
function migrateTask(task) {
  const note = task.note || "";
  const found = ALL_GUIDES.filter((g) => note.includes(`${g.label}: ${g.tip}`));
  for (const d of task.docs || []) {
    for (const g of found) {
      const i = g.docs.indexOf(d.text);
      if (i >= 0) { d.text = `${g.id}:${i}`; break; }
    }
  }
  for (const g of found) {
    if ((task.docs || []).some((d) => d.text.startsWith(`${g.id}:`))) {
      task.note = task.note.replace(`${g.label}: ${g.tip}`, "");
    }
  }
  if (found.length) task.note = task.note.split("|").map((p) => p.trim()).filter(Boolean).join(" | ");
  return task;
}

// Выпадающий список ведомств на текущем языке
function rebuildGuideOptions() {
  amtSelect.querySelectorAll("optgroup").forEach((g) => g.remove());
  for (const section of AMT_GUIDES) {
    const group = document.createElement("optgroup");
    group.label = lang === "de" ? GROUP_DE[section.group] : section.group;
    for (const item of section.items) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = guideLabel(item);
      group.appendChild(option);
    }
    amtSelect.appendChild(group);
  }
}

tasks.forEach(migrateTask);
saveTasks();

// ---------- 17. Язык интерфейса: русский / немецкий ----------
// Статичные тексты страницы: ключ = русский текст, значение = немецкий.
// Тексты, которые строит JS, переводятся через T("русский", "немецкий").
const DE = {
  "Документы в Германии": "Dokumente in Deutschland",
  "Поиск по делам": "Aufgaben suchen",
  "Фильтр по статусу": "Nach Status filtern",
  "Все": "Alle",
  "Не начато": "Offen",
  "В процессе": "In Arbeit",
  "Готово": "Erledigt",
  "Пока ничего нет": "Noch nichts da",
  "Напишите первое дело внизу или добавьте шаблон кнопкой слева.": "Schreibe unten deine erste Aufgabe oder füge links die Vorlage hinzu.",
  "Ничего не найдено": "Nichts gefunden",
  "Редактирование дела": "Aufgabe bearbeiten",
  "Отмена": "Abbrechen",
  "Дедлайн": "Frist",
  "Что взять с собой (подсказка)": "Was mitbringen (Tipp)",
  "Выберите ведомство…": "Behörde wählen…",
  "Документы попадут в чек-лист дела. Требования зависят от города и земли, уточняйте на сайте вашего ведомства.": "Die Unterlagen kommen in die Checkliste der Aufgabe. Anforderungen hängen von Stadt und Bundesland ab, prüfe die Website deiner Behörde.",
  "Заметка": "Notiz",
  "Какие документы взять, адрес ведомства": "Welche Unterlagen, Adresse der Behörde",
  "Новое дело": "Neue Aufgabe",
  "Дедлайн и заметка": "Frist und Notiz",
  "Добавить": "Hinzufügen",
  "Меню": "Menü",
  "Шаблон: первые 3 месяца": "Vorlage: erste 3 Monate",
  "Экспорт в файл": "Als Datei exportieren",
  "Импорт из файла": "Aus Datei importieren",
  "Язык": "Sprache",
  "Очистить все задачи": "Alle Aufgaben löschen",
};

// Проходим по тексту и атрибутам страницы и подставляем нужный язык.
// Оригинал (русский) запоминаем в __ru, чтобы можно было вернуться обратно.
function translateDom() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode()); ) {
    const ru = node.__ru || node.nodeValue.trim();
    if (!DE[ru]) continue;
    node.__ru = ru;
    node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), lang === "de" ? DE[ru] : ru);
  }
  for (const el of document.querySelectorAll("[placeholder], [aria-label], [title]")) {
    for (const attr of ["placeholder", "aria-label", "title"]) {
      if (!el.hasAttribute(attr)) continue;
      const ru = el["__ru_" + attr] || el.getAttribute(attr);
      if (!DE[ru]) continue;
      el["__ru_" + attr] = ru;
      el.setAttribute(attr, lang === "de" ? DE[ru] : ru);
    }
  }
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.title = T("Umzug-Tracker: документы для жизни в Германии", "Umzug-Tracker: Unterlagen für das Leben in Deutschland");
  document.querySelectorAll("[data-lang]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.lang === lang))
  );
  rebuildGuideOptions();
  translateDom();
  updateDate();
  render(); // карточки строятся из JS, поэтому перерисовываем
}

document.querySelectorAll("[data-lang]").forEach((btn) =>
  btn.addEventListener("click", () => {
    lang = btn.dataset.lang;
    safeSet(LANG_KEY, lang);
    applyLanguage();
  })
);

applyLanguage();

// ---------- 18. Очистить все задачи (с возможностью отмены) ----------
document.getElementById("clear-btn").addEventListener("click", () => {
  if (!tasks.length) return;
  const backup = tasks;
  tasks = [];
  expandedId = null;
  saveTasks();
  render();
  showToast(T("Все дела удалены", "Alle Aufgaben gelöscht"), T("Отменить", "Rückgängig"), () => {
    tasks = backup;
    saveTasks();
    render();
  });
});

// ---------- 19. Актуальная дата в шапке ----------
// Дата берётся из часов устройства (new Date()), поэтому всегда совпадает с телефоном или компьютером.
// Проверяем каждые 30 секунд, при возврате на вкладку и при фокусе окна:
// так дата обновится в полночь, после сна устройства или при смене часового пояса.
var shownDay; // var, чтобы переменная существовала уже при первом вызове updateDate()

function updateDate() {
  const now = new Date();
  const dayKey = now.toLocaleDateString("sv-SE"); // ГГГГ-ММ-ДД по местному времени
  const label = now.toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  const el = document.getElementById("today");
  el.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  el.dateTime = dayKey;
  if (shownDay && shownDay !== dayKey) render(); // наступил новый день: пересчитать дедлайны
  shownDay = dayKey;
}

setInterval(updateDate, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateDate(); });
window.addEventListener("focus", updateDate);

// ---------- 20. Защита от потери данных ----------
if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // просим браузер не чистить данные

const EXPORT_KEY = "umzug-tracker-last-export";
const REMIND_KEY = "umzug-tracker-last-reminder";

// Раз в день напоминаем о копии, если дел много, а экспорта не было 14 дней
function remindBackup() {
  const today = new Date().toLocaleDateString("sv-SE");
  const daysSince = (Date.now() - (Number(safeGet(EXPORT_KEY)) || 0)) / 86400000;
  if (tasks.length < 3 || daysSince < 14 || safeGet(REMIND_KEY) === today) return;
  safeSet(REMIND_KEY, today);
  showToast(T("Давно не было резервной копии", "Lange keine Sicherung"), T("Экспорт", "Export"),
    () => document.getElementById("export-btn").click());
}
setTimeout(remindBackup, 2000);

// Высота панели ввода нужна, чтобы уведомления не перекрывали кнопки над ней
const composerEl = document.querySelector(".composer");
new ResizeObserver(() =>
  document.documentElement.style.setProperty("--composer-h", `${composerEl.offsetHeight}px`)
).observe(composerEl);

// Обёртки: если память браузера недоступна, приложение не падает
function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* не страшно */ } }
