/* Stable dynamic-import loaders (one chunk per scene, three in its own chunk). */
export const LOADERS = {
  universe: () => import("./scenes/universe"),
  vaultCore: () => import("./scenes/vaultCore"),
  vault: () => import("./scenes/vault"),
  devCity: () => import("./scenes/devCity"),
  soc: () => import("./scenes/soc"),
  infra: () => import("./scenes/infra"),
  gallery: () => import("./scenes/gallery"),
  habitat: () => import("./scenes/habitat"),
};
