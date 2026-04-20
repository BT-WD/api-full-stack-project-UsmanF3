const searchBtn = document.getElementById("search-btn");
const backBtn = document.getElementById("back-btn");

const searchSection = document.getElementById("search-section");
const resultsSection = document.getElementById("results-section");

const input = document.getElementById("location-input");
const autocompleteList = document.getElementById("autocomplete-list");

/* MOCK AUTOCOMPLETE DATA */
const locations = [
  "123 E 23rd Street, Manhattan",
  "456 W 76th Street, Manhattan",
  "10 Broadway, Manhattan",
  "200 Park Ave, Manhattan"
];

/* AUTOCOMPLETE */
input.addEventListener("input", () => {
  const value = input.value.toLowerCase();
  autocompleteList.innerHTML = "";

  if (!value) {
    autocompleteList.style.display = "none";
    return;
  }

  const filtered = locations.filter(loc =>
    loc.toLowerCase().includes(value)
  );

  filtered.forEach(loc => {
    const li = document.createElement("li");
    li.textContent = loc;

    li.onclick = () => {
      input.value = loc;
      autocompleteList.style.display = "none";
    };

    autocompleteList.appendChild(li);
  });

  autocompleteList.style.display = "block";
});

/* SEARCH CLICK */
searchBtn.addEventListener("click", () => {
  if (!input.value) {
    alert("Please enter a location");
    return;
  }

  document.getElementById("location-title").textContent =
    "Parking near " + input.value;

  searchSection.classList.add("hidden");
  resultsSection.classList.remove("hidden");
});

/* BACK BUTTON */
backBtn.addEventListener("click", () => {
  resultsSection.classList.add("hidden");
  searchSection.classList.remove("hidden");
});
