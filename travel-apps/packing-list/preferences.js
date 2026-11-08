"use strict";
/* ================= Tyler's packing preferences =================
   Copied from the Travel Dashboard database (meta/packing, version 14, Sep 30 2026). On first run this is stored
   in the local store at meta/packing, where packing.js reads it (usual extras, maybe items, learned rules and
   lessons). Edit here to change the defaults for a fresh browser; edits to an existing browser's list happen in the app.
   The prose fields below are also turned into standing rules for the builder (PREF_RULES). */
var PACK_PREFS = {
 "beforeLeaving": "one-to-one with the packed list: a check appears only if its item is on the list; wallet, ID and the bags always appear",
 "boardingPasses": "never a check: boarding passes on phone are automatic for him",
 "chargers": "toothbrush charging cable, 2 USB-C hubs, 2 USB-C cords (cover laptop, phone, AirPods); say 'USB-C cord', never 'phone charger' or 'phone cords'; WHOOP charger always",
 "checkedBag": "replaces the carry-on: one larger checked bag plus the personal bag",
 "cooler": "Lulu joggers replace half the shorts on cooler trips",
 "extras": [
  {
   "items": [
    "Sweatshirt / hoodie",
    "Hat",
    "Brooks running shoes"
   ],
   "title": "Wear to travel"
  },
  {
   "items": [
    "T-shirts",
    "Lulu shorts",
    "Dirty clothes bag"
   ],
   "title": "Clothing"
  },
  {
   "items": [
    "Small collapsible backpack",
    "Kindle",
    "Water bottle",
    "Snacks",
    "AirPods",
    "Anker battery pack",
    "Garmin",
    "Garmin charger",
    "WHOOP charger",
    "Hotspot",
    "Belkin charging pad",
    "Glasses",
    "Costa sunglasses",
    "Eye drops",
    "Ibuprofen",
    "Dryer / washing sheets",
    "Extra phone case",
    "USB-C hub ×2",
    "USB-C cord ×2",
    "Toothbrush charging cable"
   ],
   "title": "Personal bag & day gear"
  },
  {
   "items": [
    "Contacts",
    "Toothbrush",
    "Toothpaste",
    "Lip balm",
    "Deodorant",
    "Shampoo",
    "Body wash",
    "Hairbrush",
    "Hair product",
    "Face wash",
    "Razor",
    "Shaving cream",
    "Aftershave",
    "Nail clippers",
    "Tweezers",
    "Zyrtec",
    "Prep H",
    "Ziploc bags",
    "Wrinkle release"
   ],
   "title": "Toiletries"
  }
 ],
 "formalDays": "1 day of dress clothes by default",
 "globalEntry": "never a check: Global Entry / TSA PreCheck number is stored in his phone",
 "hot": "above ~85F: more shorts, fewer pants, nothing else changes",
 "jacket": "no general jacket; sweatshirt always; light packable puffer only on cool or rainy trips",
 "laundry": "depends on the trip, ask",
 "liquids": "already in appropriate travel containers; separate dry and liquid toiletries bags, with no liquids-bag checklist item",
 "luggage": {
  "checked": "rare: mainly around the holidays or when expecting to bring stuff back",
  "default": "carry-on plus a personal bag"
 },
 "maybe": [
  {
   "items": [
    "Dress shoes",
    "Dress socks ×1",
    "White shirt ×1",
    "Undershirt ×1",
    "Extra tie or pocket square",
    "Lint roller"
   ],
   "tag": "formal",
   "title": "Formal wear",
   "when": "formal, funeral or wedding trips"
  },
  {
   "items": [
    "Swimsuit",
    "Sandals"
   ],
   "tag": "water",
   "title": "Clothing",
   "when": "there's a pool or beach"
  },
  {
   "items": [
    "Rain jacket / umbrella"
   ],
   "tag": "rain",
   "title": "Personal bag & day gear",
   "when": "rain in the forecast"
  },
  {
   "items": [
    "Light packable puffer jacket",
    "Lulu joggers",
    "Gloves",
    "Beanie",
    "Thermal base layers"
   ],
   "tag": "cold",
   "title": "Clothing",
   "when": "cold weather (below about 40°F)"
  },
  {
   "items": [
    "Passport",
    "Plug adapter"
   ],
   "tag": "intl",
   "title": "Personal bag & day gear",
   "when": "international trips"
  },
  {
   "items": [
    "Neck pillow",
    "Earplugs",
    "Eye mask"
   ],
   "tag": "longintl",
   "title": "Personal bag & day gear",
   "when": "long international flights"
  },
  {
   "items": [
    "Button-up long sleeve shirt ×1"
   ],
   "tag": "dinner",
   "title": "Clothing",
   "when": "nice dinners (one per dinner)"
  },
  {
   "items": [
    "Light packable puffer jacket",
    "Lulu joggers"
   ],
   "tag": "cool",
   "title": "Clothing",
   "when": "cool or rainy weather"
  },
  {
   "items": [
    "Hiking boots / trail shoes"
   ],
   "tag": "hike",
   "title": "Clothing",
   "when": "hiking trips"
  },
  {
   "items": [
    "Fishing gear",
    "Fishing license"
   ],
   "tag": "fish",
   "title": "Gear",
   "when": "fishing trips"
  },
  {
   "items": [
    "Work computer",
    "Monitors ×2",
    "Monitor cables ×2",
    "Logitech mouse",
    "Keyboard",
    "Mouse pad"
   ],
   "tag": "work",
   "title": "Work",
   "when": "a working trip where you work that day"
  },
  {
   "items": [
    "Work computer"
   ],
   "tag": "laptop",
   "title": "Work",
   "when": "you might need your laptop (no work planned)"
  }
 ],
 "planeComfort": "Kindle always; neck pillow, earplugs and eye mask only on long international flights",
 "shoes": "always wears Brooks running shoes; other shoes only for hiking (trail shoes/boots) or formal events (dress shoes)",
 "sleepwear": "none, sleeps in what he has",
 "withTaryn": "separate lists, his things only",
 "workouts": "no separate workout clothes; Lulu shorts and T-shirts cover workouts, never list workout clothes"
};
var PREF_LABELS = {shoes:"Shoes", chargers:"Chargers", jacket:"Jackets", liquids:"Liquids", hot:"Hot weather", cooler:"Cooler trips",
  workouts:"Workouts", sleepwear:"Sleepwear", planeComfort:"Plane comfort", formalDays:"Formal", laundry:"Laundry", withTaryn:"Traveling with Taryn",
  checkedBag:"Checked bag", beforeLeaving:"Before leaving", boardingPasses:"Boarding passes", globalEntry:"Global Entry / PreCheck"};
var PREF_RULES = Object.keys(PREF_LABELS).filter(function(k){ return typeof PACK_PREFS[k] === "string"; }).map(function(k){ return PREF_LABELS[k] + ": " + PACK_PREFS[k]; });
