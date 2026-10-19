import { createApp } from "vue";
import { createPinia } from "pinia";
import naive from "naive-ui";
import App from "./App.vue";
import router from "./router/index.js";
import { useAuthStore } from "./stores/auth.js";
import "./style.css";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(naive);

const auth = useAuthStore();
await auth.init();
app.mount("#app");
