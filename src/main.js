import { createApp } from "vue";
import { createPinia } from "pinia";
import naive from "naive-ui";
import App from "./App.vue";
import router from "./router/index.js";
import { useAuthStore } from "./stores/auth.js";
import { startOfflineSaleSync } from "./services/offlineSaleSync.js";
import { startAdminOutboxSync } from "./services/adminOutboxSync.js";
import { useMetaCacheStore } from "./stores/metaCache.js";
import { useAdminOutboxStore } from "./stores/adminOutbox.js";
import "./style.css";
import "./styles/moreFilters.css";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(naive);

const auth = useAuthStore();
useMetaCacheStore().hydrateFromStorage();
useAdminOutboxStore().hydrate();
await auth.init();
startOfflineSaleSync();
startAdminOutboxSync();
app.mount("#app");
