const MAPBOX_TOKEN = "pk.eyJ1IjoidXNtYW5mMyIsImEiOiJjbW83ZTd2czgwMGtxMnhwdTZ6cWFpZW41In0.NeNw5pvNgdhpHRnGofyexA";

const searchBtn = document.getElementById("search-btn");
const backBtn = document.getElementById("back-btn");

const searchSection = document.getElementById("search-section");
const resultsSection = document.getElementById("results-section");

const input = document.getElementById("location-input");
const autocompleteList = document.getElementById("autocomplete-list");
const resultsContainer = document.getElementById("data-container");

input.addEventListener("input", async () => {
  const query = input.value.trim();

  if (query.length < 3) {
    autocompleteList.style.display = "none";
    return;
  }

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5`
    );

    if (!res.ok) throw new Error("Autocomplete API failed");

    const data = await res.json();

    autocompleteList.innerHTML = "";

    data.features.forEach(place => {
      const li = document.createElement("li");
      li.textContent = place.place_name;

      li.onclick = () => {
        input.value = place.place_name;
        input.dataset.lng = place.center[0];
        input.dataset.lat = place.center[1];
        autocompleteList.style.display = "none";
      };

      autocompleteList.appendChild(li);
    });

    autocompleteList.style.display = "block";

  } catch (err) {
    console.error(err);
  }
});

searchBtn.addEventListener("click", async () => {
  const location = input.value;
  const lat = input.dataset.lat;
  const lng = input.dataset.lng;

  if (!location || !lat || !lng) {
    alert("Please select a valid location from the dropdown.");
    return;
  }

  document.getElementById("location-title").textContent =
    "Parking near " + location;

  searchSection.classList.add("hidden");
  resultsSection.classList.remove("hidden");

  await loadParkingData(lat, lng);
});

async function loadParkingData(lat, lng) {
  resultsContainer.innerHTML = "<p>Loading parking data...</p>";

  try {
    await new Promise(r => setTimeout(r, 800));
    const fakeData = generateFakeParking(lat, lng);
    renderParkingCards(fakeData);
  } catch (err) {
    console.error(err);
    resultsContainer.innerHTML = "<p>Error loading data.</p>";
  }
}

function generateFakeParking(lat, lng) {
  const streets = [
    "E 23rd Street",
    "W 76th Street",
    "5th Avenue",
    "Madison Ave",
    "Broadway"
  ];

  return streets.map((street, i) => {
    const hours = Math.floor(Math.random() * 24);

    let status = "safe";
    if (hours < 6) status = "danger";
    else if (hours < 12) status = "warning";

    return {
      street,
      side: i % 2 === 0 ? "North Side" : "South Side",
      distance: (Math.random() * 0.5).toFixed(2),
      safeUntil: `${hours} hours`,
      nextCleaning: "Friday 8:00 AM – 11:00 AM",
      status
    };
  });
}

function renderParkingCards(data) {
  resultsContainer.innerHTML = "";

  data.forEach(block => {
    const card = document.createElement("div");
    card.className = `block-card ${block.status}`;

    card.innerHTML = `
      <div class="card-header">
        <h3>${block.street} <span class="side">${block.side}</span></h3>
        <span>✔</span>
      </div>
      <p class="distance">${block.distance} miles away</p>
      <div class="safe-time">Safe for: ${block.safeUntil}</div>
      <div class="next-cleaning">Next cleaning: ${block.nextCleaning}</div>
    `;

    resultsContainer.appendChild(card);
  });

  const safeCount = data.filter(d => d.status === "safe").length;

  document.getElementById("summary-text").textContent =
    `${safeCount} of ${data.length} blocks are safe`;

  document.getElementById("summary-subtext").textContent =
    "Live data (simulated)";
}

backBtn.addEventListener("click", () => {
  resultsSection.classList.add("hidden");
  searchSection.classList.remove("hidden");
});
