const DEFAULT_TARGET = "https://kinokino.win";
const input = document.getElementById("target");
const status = document.getElementById("status");

// Accepts "site.com", "https://site.com/", "http://site.com/path" -> "https://site.com" / "http://site.com".
function normalize(value) {
  let v = value.trim();
  if (!v) return DEFAULT_TARGET;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    return new URL(v).origin;
  } catch {
    return null;
  }
}

function save(value) {
  const t = normalize(value);
  if (!t) {
    status.style.color = "#ff5555";
    status.textContent = "Некорректный адрес";
    return;
  }
  chrome.storage.sync.set({ target: t }, () => {
    input.value = t;
    status.style.color = "#55ff55";
    status.textContent = "Сохранено";
    setTimeout(() => (status.textContent = ""), 1500);
  });
}

chrome.storage.sync.get({ target: DEFAULT_TARGET }, (data) => {
  input.value = data.target;
});

document.getElementById("save").addEventListener("click", () => save(input.value));
document.getElementById("reset").addEventListener("click", () => save(DEFAULT_TARGET));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save(input.value);
});
