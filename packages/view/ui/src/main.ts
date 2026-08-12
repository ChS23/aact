import { mount } from "svelte";

import App from "./App.svelte";

const target = document.querySelector("#app");
if (!target) {
  throw new Error("aact view: #app mount point missing in index.html");
}
mount(App, { target });
