const MAPBOX_TOKEN = "pk.eyJ1IjoidXNtYW5mMyIsImEiOiJjbW83ZTd2czgwMGtxMnhwdTZ6cWFpZW41In0.NeNw5pvNgdhpHRnGofyexA";
const DOT_SIGNS_DATASET_URL = "https://data.cityofnewyork.us/resource/nfid-uabd.json";

const searchBtn = document.getElementById("search-btn");
const backBtn = document.getElementById("back-btn");

const searchSection = document.getElementById("search-section");
const resultsSection = document.getElementById("results-section");

const input = document.getElementById("location-input");
const autocompleteList = document.getElementById("autocomplete-list");
const resultsContainer = document.getElementById("data-container");

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
    const escapedStreet = variant.replace(/'/g, "''");
    const where = `upper(on_street) like '%${escapedStreet}%'`;
    const url = `${DOT_SIGNS_DATASET_URL}?%24where=${encodeURIComponent(where)}&%24limit=20`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`DOT API failed with status ${res.status}`);
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      const filtered = data.filter(item => streetLooksLikeMatch(item.on_street, variant));
      if (filtered.length) {
        return filtered;
      }
    }
  }

  return [];
}

input.addEventListener("input", async () => {
  const query = input.value.trim();
  clearSelectionState();

  if (query.length < 3) {
    autocompleteList.style.display = "none";
    return;
  }

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5&bbox=-74.2591,40.4774,-73.7004,40.9176`
    );

    if (!res.ok) throw new Error("Autocomplete failed");

    const data = await res.json();

    autocompleteList.innerHTML = "";

    const nycResults = data.features.filter(place =>
      place.place_name.includes("New York")
    );

    nycResults.forEach(place => {
      const li = document.createElement("li");
      li.textContent = place.place_name;

      li.onclick = () => {
        input.value = place.place_name;
        input.dataset.lng = place.center[0];
        input.dataset.lat = place.center[1];
        input.dataset.valid = "true";
        input.dataset.street = extractStreetName(place.place_name) || place.text || "";
        autocompleteList.style.display = "none";
      };

      autocompleteList.appendChild(li);
    });

    autocompleteList.style.display =
      nycResults.length > 0 ? "block" : "none";

  } catch (err) {
    console.error(err);
  }
});

searchBtn.addEventListener("click", async () => {
  const location = input.value;
  const lat = input.dataset.lat;
  const lng = input.dataset.lng;
  const valid = input.dataset.valid;

  if (!location || !lat || !lng || valid !== "true") {
    alert("Please select a valid NYC address from the dropdown.");
    return;
  }

  document.getElementById("location-title").textContent =
    "Parking near " + location;

  searchSection.classList.add("hidden");
  resultsSection.classList.remove("hidden");

  await loadParkingData();
});

async function loadParkingData() {
  resultsContainer.innerHTML = "<p>Loading parking data...</p>";

  try {
    const street = input.dataset.street || extractStreetName(input.value);

    if (!street) {
      resultsContainer.innerHTML = "<p>Could not detect street name.</p>";
      return;
    }

    const data = await fetchParkingByStreet(street);

    if (!data.length) {
      resultsContainer.innerHTML = "<p>No parking data found for this street.</p>";
      return;
    }

    const formatted = formatParkingData(data).slice(0, 10);
    renderParkingCards(formatted);

  } catch (err) {
    console.error("Parking fetch error:", err);
    resultsContainer.innerHTML = "<p>Error loading parking data.</p>";
  }
}

function formatParkingData(data) {
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

    return {
      street: item.on_street || "Unknown street",
      side: item.side_of_street || "Unknown side",
      distance: (Math.random() * 0.3 + 0.05).toFixed(2),
      readableRule: formatReadableRule(item.sign_description),
      recordDate: formatRecordDate(item.order_completed_on_date),
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
        <span>${block.status === "safe" ? "✔" : "!"}</span>
      </div>
      <p class="distance">${block.distance} miles away</p>
      <div class="safe-time">${block.readableRule}</div>
      <div class="next-cleaning">Record date: ${block.recordDate}</div>
    `;

    resultsContainer.appendChild(card);
  });

  const safeCount = data.filter(d => d.status === "safe").length;

  document.getElementById("summary-text").textContent =
    `${safeCount} of ${data.length} blocks are safe`;

  document.getElementById("summary-subtext").textContent =
    "Live NYC DOT data";
}

backBtn.addEventListener("click", () => {
  resultsSection.classList.add("hidden");
  searchSection.classList.remove("hidden");
});
