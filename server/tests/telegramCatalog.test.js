const test = require("node:test");
const expect = require("./expect");
const catalog = require("../utils/telegramCatalog");

test("Telegram command registry is unique and within the Bot API command limit", () => {
  const names = catalog.BOT_COMMANDS.map(x => x.command);
  expect(names.length <= 100).toBe(true);
  expect(new Set(names).size === names.length).toBe(true);
  for (const name of ["status","pass","expenses","security"]) expect(names.includes(name)).toBe(true);
});
test("notification default means every category is enabled", () => {
  expect(catalog.normalizeNotificationCategories("all")).toEqual(catalog.NOTIFICATION_CATEGORIES);
  for (const category of catalog.NOTIFICATION_CATEGORIES) expect(catalog.notificationsEnabled({}, category)).toBe(true);
});
test("notification category preferences are validated and deduplicated", () => {
  expect(catalog.normalizeNotificationCategories(["home","servers","home","unknown"])).toEqual(["home","servers"]);
  expect(catalog.notificationsEnabled({notificationCategories:["home"]},"home")).toBe(true);
  expect(catalog.notificationsEnabled({notificationCategories:["home"]},"money")).toBe(false);
});
