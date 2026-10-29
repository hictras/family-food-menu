import express from "express";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import webpush from "web-push";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "food-menu.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  ingredients TEXT DEFAULT '',
  steps TEXT DEFAULT '',
  meal_type TEXT DEFAULT 'Dinner',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  menu_date TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  push_endpoint TEXT UNIQUE,
  push_keys TEXT
);
`);

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:family@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function notifyFamily({ title, body, url = "/" }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const members = db.prepare(`
    SELECT * FROM family_members WHERE push_endpoint IS NOT NULL
  `).all();

  await Promise.allSettled(members.map(async (member) => {
    const subscription = {
      endpoint: member.push_endpoint,
      keys: JSON.parse(member.push_keys || "{}")
    };

    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title, body, url }));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare("DELETE FROM family_members WHERE id = ?").run(member.id);
      }
    }
  }));
}

app.get("/api/config", (req, res) => {
  res.json({ vapidPublicKey: VAPID_PUBLIC_KEY });
});

app.get("/api/recipes", (req, res) => {
  res.json(db.prepare("SELECT * FROM recipes ORDER BY title").all());
});

app.get("/api/recipes/:id", (req, res) => {
  const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  res.json(recipe);
});

app.post("/api/recipes", async (req, res) => {
  try {
    const {
      title,
      description = "",
      ingredients = "",
      steps = "",
      meal_type = "Dinner"
    } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Recipe title is required" });
    }

    const allowed = ["Breakfast", "Lunch", "Dinner", "Snack"];
    const safeMealType = allowed.includes(meal_type) ? meal_type : "Dinner";

    const result = db.prepare(`
      INSERT INTO recipes (title, description, ingredients, steps, meal_type)
      VALUES (?, ?, ?, ?, ?)
    `).run(title.trim(), description.trim(), ingredients.trim(), steps.trim(), safeMealType);

    const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(result.lastInsertRowid);

    res.status(201).json({ message: "Recipe saved successfully", recipe });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not save recipe" });
  }
});

app.put("/api/recipes/:id", async (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    if (!Number.isInteger(recipeId) || recipeId <= 0) {
      return res.status(400).json({ error: "Invalid recipe ID" });
    }

    const {
      title,
      description = "",
      ingredients = "",
      steps = "",
      meal_type = "Dinner"
    } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Recipe title is required" });
    }

    const allowed = ["Breakfast", "Lunch", "Dinner", "Snack"];
    const safeMealType = allowed.includes(meal_type) ? meal_type : "Dinner";

    const result = db.prepare(`
      UPDATE recipes
      SET title = ?, description = ?, ingredients = ?, steps = ?, meal_type = ?
      WHERE id = ?
    `).run(title.trim(), description.trim(), ingredients.trim(), steps.trim(), safeMealType, recipeId);

    if (!result.changes) return res.status(404).json({ error: "Recipe not found" });

    const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(recipeId);
    res.json({ message: "Recipe updated successfully", recipe });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update recipe" });
  }
});

app.delete("/api/recipes/:id", (req, res) => {
  db.prepare("DELETE FROM recipes WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/menu", (req, res) => {
  const { start, end } = req.query;
  const rows = db.prepare(`
    SELECT m.id, m.menu_date, m.meal_type,
           r.id AS recipe_id, r.title, r.description,
           r.ingredients, r.steps
    FROM menu_items m
    JOIN recipes r ON r.id = m.recipe_id
    WHERE m.menu_date BETWEEN ? AND ?
    ORDER BY m.menu_date, m.meal_type
  `).all(start, end);

  res.json(rows);
});

app.post("/api/menu", async (req, res) => {
  try {
    const { recipe_id, menu_date, meal_type = "Dinner" } = req.body;

    if (!recipe_id || !menu_date) {
      return res.status(400).json({ error: "recipe_id and menu_date are required" });
    }

    const recipe = db.prepare("SELECT * FROM recipes WHERE id = ?").get(recipe_id);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });

    const result = db.prepare(`
      INSERT INTO menu_items (recipe_id, menu_date, meal_type)
      VALUES (?, ?, ?)
    `).run(recipe_id, menu_date, meal_type);

    await notifyFamily({
      title: "New meal added",
      body: `${meal_type}: ${recipe.title} was added for ${menu_date}.`,
      url: "/"
    });

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not add meal" });
  }
});

app.delete("/api/menu/:id", (req, res) => {
  db.prepare("DELETE FROM menu_items WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/family", (req, res) => {
  const { name, phone, subscription } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: "Name and phone number are required" });
  }

  const endpoint = subscription?.endpoint || null;
  const keys = subscription?.keys ? JSON.stringify(subscription.keys) : null;

  db.prepare(`
    INSERT INTO family_members (name, phone, push_endpoint, push_keys)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(push_endpoint) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      push_keys = excluded.push_keys
  `).run(name, phone, endpoint, keys);

  res.json({ ok: true });
});

app.post("/api/notify", async (req, res) => {
  const { title, body } = req.body;
  await notifyFamily({
    title: title || "Family Food Menu",
    body: body || "Check today’s menu!"
  });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Family Food Menu running on port ${PORT}`);
});
