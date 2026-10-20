const form = document.getElementById('form');
const saved = document.getElementById('saved');
let savedTimer;

async function load() {
  const settings = await getSettings();
  for (const el of form.elements) {
    if (!(el.name in settings)) continue;
    if (el.type === 'checkbox') el.checked = settings[el.name];
    else el.value = settings[el.name];
  }
}

// Every change saves straight away.
form.addEventListener('change', async (e) => {
  const el = e.target;
  await chrome.storage.sync.set({ [el.name]: el.type === 'checkbox' ? el.checked : el.value });
  saved.classList.add('visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('visible'), 1200);
});

async function showStatus() {
  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  document.getElementById('status').hidden = allowed;
}

async function showCommands() {
  // Chrome also lists its own _execute_action (clicking the toolbar icon).
  const commands = (await chrome.commands.getAll()).filter((cmd) => !cmd.name.startsWith('_'));
  const rows = commands.map((cmd) => {
    const tr = document.createElement('tr');
    const keys = document.createElement('td');
    if (cmd.shortcut) {
      keys.append(...cmd.shortcut.split('+').flatMap((k, i) => {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        return i ? [' ', kbd] : [kbd];
      }));
    } else {
      keys.innerHTML = '<span class="unset">Not set</span>';
    }
    const desc = document.createElement('td');
    desc.textContent = cmd.description;
    tr.append(keys, desc);
    return tr;
  });
  document.getElementById('commands').replaceChildren(...rows);
}

document.getElementById('open-details').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
document.getElementById('open-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Pick up changes made on the details or shortcuts page when coming back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    showStatus();
    showCommands();
  }
});

load();
showStatus();
showCommands();
