// Stashr updates are delivered as signed, complete APKs from the Stashr API server.
// OTA updates are served by the Stashr API server (/api/ota/manifest). Native module and
// permission changes still ship as a freshly built APK installed by Android.
module.exports = ({ config }) => {
  const extra = config.extra || {};
  return {
    ...config,
    updates: {
      ...(config.updates || {}),
      enabled: true,
      url: process.env.STASHR_OTA_URL || "https://password-manager-server-xxdr.onrender.com/api/ota/manifest",
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    extra: {
      ...extra,
      stashrRelease: {
        ...(extra.stashrRelease || {}),
        appVersion: config.version || "unknown",
        channel: "server-managed",
        delivery: "server-managed-apk",
      },
    },
  };
};
