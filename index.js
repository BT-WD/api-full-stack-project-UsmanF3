const MAPBOX_TOKEN = "pk.eyJ1IjoidXNtYW5mMyIsImEiOiJjbW83ZTd2czgwMGtxMnhwdTZ6cWFpZW41In0.NeNw5pvNgdhpHRnGofyexA";
const DOT_SIGNS_DATASET_URL = "https://data.cityofnewyork.us/resource/nfid-uabd.json";

const API_RETRY_ATTEMPTS = 3;
const API_TIMEOUT_MS = 8000;
const MAPBOX_BBOX = "-74.2591,40.4774,-73.7004,40.9176";

let currentSearchCoords = null;
let filteredParkingData = [];
let currentFilter = "all";

const searchBtn = document.getElementById("search-btn");
const backBtn = document.getElementById("back-btn");

const searchSection = document.getElementById("search-section");
const resultsSection = document.getElementById("results-section");

const input = document.getElementById("location-input");
const autocompleteList = document.getElementById("autocomplete-list");
const resultsContainer = document.getElementById("data-container");

async function fetchWithRetry(url, options = {}) {
  const maxAttempts = options.maxAttempts || API_RETRY_ATTEMPTS;
  const timeout = options.timeout || API_TIMEOUT_MS;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (attempt === maxAttempts) {
        throw error;
      }
      
      const delayMs = 500 * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const toRad = Math.PI / 180;
  
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function clearSelectionState() {
  delete input.dataset.lng;
  delete input.dataset.lat;
  delete input.dataset.valid;
  delete input.dataset.street;
}

function extractStreetName(addressText) {
  if (!addressText) return "";

  const parts = addressText.split(",").map(part => part.trim()).filter(Boolean);

  if (parts.length > 0) {
    const firstPart = parts[0];
    const withoutBuildingNumber = firstPart
      .replace(/^\d+[A-Za-z-]*\s*/, "")
      .replace(/^\d+\s+/, "")
      .trim();
    if (withoutBuildingNumber.length > 1) {
      return withoutBuildingNumber;
    }
  }

  return addressText.trim();
}

function normalizeStreetVariants(streetName) {
  const upper = streetName.toUpperCase().trim();
  const normalized = upper
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const expanded = normalized
    .replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\bAV\b/g, "AVENUE")
    .replace(/\bBLVD\b/g, "BOULEVARD")
    .replace(/\bRD\b/g, "ROAD");

  const withoutOrdinal = expanded.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1");
  const withoutStreetWord = withoutOrdinal.replace(/\b(STREET|AVENUE|ROAD|BOULEVARD)\b/g, "").replace(/\s+/g, " ").trim();
  const numericToken = (withoutOrdinal.match(/\b\d+\b/) || [""])[0];

  const variants = new Set([
    normalized,
    expanded,
    withoutOrdinal,
    withoutStreetWord,
    numericToken ? `${numericToken} STREET` : "",
    numericToken
  ]);

  return Array.from(variants).filter(Boolean);
}

function toComparableStreet(value) {
  return (value || "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(\d+)(ST|ND|RD|TH)\b/g, "$1")
    .replace(/\bST\b/g, "STREET")
    .replace(/\bAVE\b/g, "AVENUE")
    .replace(/\bAV\b/g, "AVENUE")
    .replace(/\bBLVD\b/g, "BOULEVARD")
    .replace(/\bRD\b/g, "ROAD")
    .replace(/\s+/g, " ")
    .trim();
}

function streetLooksLikeMatch(apiStreetName, streetVariant) {
  const apiComparable = toComparableStreet(apiStreetName);
  const variantComparable = toComparableStreet(streetVariant);

  if (!apiComparable || !variantComparable) return false;
  if (apiComparable === variantComparable) return true;

  const variantTokens = variantComparable.split(" ").filter(Boolean);
  return variantTokens.every(token => {
    if (/^\d+$/.test(token)) {
      return new RegExp(`\\b${token}\\b`).test(apiComparable);
    }
    return apiComparable.includes(token);
  });
}

function formatReadableRule(description) {
  if (!description) return "See posted sign";

  const cleaned = description
    .toUpperCase()
    .replace(/\(SUPERSEDES[^)]*\)/g, "")
    .replace(/\(SANITATION BROOM SYMBOL\)/g, "")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const ruleTypeMatch = cleaned.match(/NO\s+(PARKING|STANDING|STOPPING)/);
  let ruleType = ruleTypeMatch ? `NO ${ruleTypeMatch[1]}` : "";

  if (!ruleType) {
    const altRuleMatch = cleaned.match(
      /(\d+\s+HOUR\s+PARKING|METERED\s+PARKING|PARKING\s+METERED|COMMERCIAL\s+VEHICLES\s+ONLY|TRUCK\s+LOADING\s+ONLY|BUS\s+STOP)/
    );
    if (altRuleMatch) {
      ruleType = altRuleMatch[1];
    }
  }

  const dayLookup = {
    MON: "MONDAY",
    MONDAY: "MONDAY",
    TUE: "TUESDAY",
    TUES: "TUESDAY",
    TUESDAY: "TUESDAY",
    WED: "WEDNESDAY",
    WEDNESDAY: "WEDNESDAY",
    THU: "THURSDAY",
    THUR: "THURSDAY",
    THURS: "THURSDAY",
    THURSDAY: "THURSDAY",
    FRI: "FRIDAY",
    FRIDAY: "FRIDAY",
    SAT: "SATURDAY",
    SATURDAY: "SATURDAY",
    SUN: "SUNDAY",
    SUNDAY: "SUNDAY"
  };

  const dayRegex = /\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN)\b/g;
  const dayMatches = cleaned.match(dayRegex) || [];
  const uniqueDays = [...new Set(dayMatches.map(day => dayLookup[day]))].filter(Boolean);
  const hasExcept = /\bEXCEPT\b/.test(cleaned);
  const dayTokenPattern = "MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN";
  const dayRangeMatch = cleaned.match(new RegExp(`\\b(${dayTokenPattern})\\b\\s*(?:TO|THRU|THROUGH|-)\\s*\\b(${dayTokenPattern})\\b`));

  let dayPart = "";
  if (dayRangeMatch) {
    const start = dayLookup[dayRangeMatch[1]];
    const end = dayLookup[dayRangeMatch[2]];
    if (start && end) {
      dayPart = hasExcept ? `EXCEPT ${start}-${end}` : `${start}-${end}`;
    }
  } else if (uniqueDays.length === 1) {
    dayPart = hasExcept ? `EXCEPT ${uniqueDays[0]}` : uniqueDays[0];
  } else if (uniqueDays.length > 1) {
    dayPart = hasExcept
      ? `EXCEPT ${uniqueDays.join("/")}`
      : uniqueDays.join("/");
  }

  const timeRegex = /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\b/;
  const timeMatch = cleaned.match(timeRegex);
  const timePart = timeMatch ? timeMatch[0].replace(/\s+/g, "") : "";

  const compact = [ruleType, dayPart, timePart].filter(Boolean);
  if (compact.length >= 2) {
    return compact.join(" ");
  }

  if (ruleType && cleaned.startsWith(ruleType)) {
    return cleaned;
  }

  return cleaned;
}

function formatRecordDate(dateValue) {
  if (!dateValue) return "Date not available";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;

  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

async function fetchParkingByStreet(streetName) {
  const variants = normalizeStreetVariants(streetName);

  for (const variant of variants) {
    try {
      const escapedStreet = variant.replace(/'/g, "''");
      const where = `upper(on_street) like '%${escapedStreet}%'`;
      const url = `${DOT_SIGNS_DATASET_URL}?%24where=${encodeURIComponent(where)}&%24limit=50`;

      const res = await fetchWithRetry(url, { 
        maxAttempts: 2,
        timeout: 6000 
      });

      const data = await res.json();
      
      if (Array.isArray(data) && data.length) {
        const filtered = data.filter(item => streetLooksLikeMatch(item.on_street, variant));
        if (filtered.length) {
          return filtered;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch parking for variant "${variant}":`, error.message);
      continue;
    }
  }

  return [];
}

let autocompleteHighlightIndex = -1;

function clearAutocompleteHighlight() {
  const items = autocompleteList.querySelectorAll("li");
  items.forEach(item => item.classList.remove("highlighted"));
  autocompleteHighlightIndex = -1;
}

function showAutocompleteLoading() {
  autocompleteList.innerHTML = '<li class="loading">Searching...</li>';
  autocompleteList.style.display = "block";
}

input.addEventListener("input", async () => {
  const query = input.value.trim();
  clearSelectionState();
  clearAutocompleteHighlight();

  if (query.length < 3) {
    autocompleteList.style.display = "none";
    return;
  }

  showAutocompleteLoading();

  try {
    const res = await fetchWithRetry(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=8&bbox=${MAPBOX_BBOX}`,
      { timeout: 5000 }
    );

    if (!res.ok) throw new Error("Autocomplete API failed");

    const data = await res.json();
    autocompleteList.innerHTML = "";

    const nycResults = data.features.filter(place =>
      place.place_name.toLowerCase().includes("new york")
    );

    if (nycResults.length === 0) {
      autocompleteList.innerHTML = '<li class="no-results">No NYC results found</li>';
      autocompleteList.style.display = "block";
      return;
    }

    nycResults.forEach((place, index) => {
      const li = document.createElement("li");
      li.textContent = place.place_name;
      li.setAttribute("data-index", index);

      li.onclick = () => selectAutocompleteItem(place);
      li.onmouseover = () => {
        clearAutocompleteHighlight();
        li.classList.add("highlighted");
        autocompleteHighlightIndex = index;
      };

      autocompleteList.appendChild(li);
    });

    autocompleteList.style.display = "block";

  } catch (err) {
    console.error("Autocomplete error:", err);
    autocompleteList.innerHTML = '<li class="error">Error loading suggestions</li>';
    autocompleteList.style.display = "block";
  }
});

function selectAutocompleteItem(place) {
  input.value = place.place_name;
  input.dataset.lng = place.center[0];
  input.dataset.lat = place.center[1];
  input.dataset.valid = "true";
  input.dataset.street = extractStreetName(place.place_name) || place.text || "";
  currentSearchCoords = { lat: place.center[1], lng: place.center[0] };
  autocompleteList.style.display = "none";
  clearAutocompleteHighlight();
}

input.addEventListener("keydown", (e) => {
  const items = autocompleteList.querySelectorAll("li:not(.loading):not(.error):not(.no-results)");
  
  if (e.key === "ArrowDown") {
    e.preventDefault();
    autocompleteHighlightIndex = Math.min(autocompleteHighlightIndex + 1, items.length - 1);
    clearAutocompleteHighlight();
    if (items[autocompleteHighlightIndex]) {
      items[autocompleteHighlightIndex].classList.add("highlighted");
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    autocompleteHighlightIndex = Math.max(autocompleteHighlightIndex - 1, -1);
    clearAutocompleteHighlight();
    if (autocompleteHighlightIndex >= 0 && items[autocompleteHighlightIndex]) {
      items[autocompleteHighlightIndex].classList.add("highlighted");
    }
  } else if (e.key === "Enter" && autocompleteHighlightIndex >= 0) {
    e.preventDefault();
    items[autocompleteHighlightIndex].click();
  }
});

document.addEventListener("click", (e) => {
  if (e.target !== input && !autocompleteList.contains(e.target)) {
    autocompleteList.style.display = "none";
  }
});


searchBtn.addEventListener("click", async () => {
  const location = input.value.trim();
  const lat = input.dataset.lat;
  const lng = input.dataset.lng;
  const valid = input.dataset.valid;

  if (!location) {
    showInputError("Please enter a location");
    return;
  }

  if (!lat || !lng || valid !== "true") {
    showInputError("Please select a valid NYC address from the dropdown");
    return;
  }

  document.getElementById("location-title").textContent = "Parking near " + location;

  searchSection.classList.add("hidden");
  resultsSection.classList.remove("hidden");

  await loadParkingData();
});

function showInputError(message) {
  alert(message);
  input.focus();
  input.classList.add("error");
  setTimeout(() => input.classList.remove("error"), 2000);
}

async function loadParkingData() {
  resultsContainer.innerHTML = '<div class="loading-spinner"><p>Loading parking data...</p></div>';
  currentFilter = "all";

  try {
    const street = input.dataset.street || extractStreetName(input.value);

    if (!street) {
      resultsContainer.innerHTML = '<p class="error-message">Could not detect street name. Please try a different address.</p>';
      return;
    }

    const data = await fetchParkingByStreet(street);

    if (!data.length) {
      resultsContainer.innerHTML = '<p class="error-message">No parking data found for this street. Try a nearby street.</p>';
      return;
    }

    const formatted = formatParkingData(data).slice(0, 20);
    filteredParkingData = formatted;
    
    renderParkingCards(formatted);
    setupFilters();

  } catch (err) {
    console.error("Parking fetch error:", err);
    resultsContainer.innerHTML = `<p class="error-message">Failed to load parking data. Please try again.</p>`;
  }
}


function formatParkingData(data) {
  if (!currentSearchCoords) return [];

  return data.map(item => {
    let status = "safe";
    const signDescription = (item.sign_description || "").toUpperCase();

    if (signDescription.includes("NO PARKING")) {
      status = "danger";
    } else if (signDescription.includes("NO STANDING")) {
      status = "warning";
    } else if (signDescription.includes("SUSPENDED")) {
      status = "suspended";
    }

    let distance = 0;
    if (item.latitude && item.longitude) {
      distance = calculateDistance(
        currentSearchCoords.lat,
        currentSearchCoords.lng,
        parseFloat(item.latitude),
        parseFloat(item.longitude)
      );
    }

    return {
      street: item.on_street || "Unknown street",
      side: item.side_of_street || "Unknown side",
      distance: Math.max(distance, 0.05).toFixed(2),
      readableRule: formatReadableRule(item.sign_description),
      recordDate: formatRecordDate(item.order_completed_on_date),
      status
    };
  }).sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
}

function renderParkingCards(data) {
  resultsContainer.innerHTML = "";

  if (!data || data.length === 0) {
    resultsContainer.innerHTML = '<p class="no-results">No parking spots match your filter</p>';
    return;
  }

  data.forEach(block => {
    const card = document.createElement("div");
    card.className = `block-card ${block.status}`;

    const statusIcon = block.status === "safe" ? "✓" : "⚠";
    const statusLabel = {
      safe: "Safe",
      warning: "Check Posted Rules",
      danger: "No Parking",
      suspended: "Suspended"
    }[block.status] || "Unknown";

    card.innerHTML = `
      <div class="card-header">
        <div>
          <h3>${block.street} <span class="side">${block.side}</span></h3>
          <p class="status-label">${statusIcon} ${statusLabel}</p>
        </div>
        <span class="distance-badge">${block.distance} mi</span>
      </div>
      <p class="rule-text">${block.readableRule}</p>
      <div class="card-footer">
        <small>Updated: ${block.recordDate}</small>
      </div>
    `;

    resultsContainer.appendChild(card);
  });

  const safeCount = data.filter(d => d.status === "safe").length;
  const warningCount = data.filter(d => d.status === "warning").length;

  document.getElementById("summary-text").textContent =
    `${safeCount} of ${data.length} blocks are safe`;

  document.getElementById("summary-subtext").textContent =
    `${warningCount} blocks need attention • Updated: ${new Date().toLocaleTimeString()}`;
}

function setupFilters() {
  const filterButtons = document.querySelectorAll(".filters button");
  
  filterButtons.forEach(btn => {
    btn.classList.remove("active");
    btn.onclick = () => {
      filterButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      const filterType = btn.textContent.trim();
      applyFilter(filterType);
    };
  });

  filterButtons[0].classList.add("active");
}

function applyFilter(filterType) {
  let filtered = [...filteredParkingData];

  if (filterType === "Safe Now") {
    filtered = filtered.filter(d => d.status === "safe");
  } else if (filterType === "Closest First") {
    filtered.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
  } else if (filterType === "All Blocks") {
    filtered.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
  }

  renderParkingCards(filtered);
}

backBtn.addEventListener("click", () => {
  resultsSection.classList.add("hidden");
  searchSection.classList.remove("hidden");
  clearSelectionState();
  input.focus();
});
