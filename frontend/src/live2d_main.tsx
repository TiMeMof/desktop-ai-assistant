import React from "react";
import ReactDOM from "react-dom/client";
import { Live2DWindow } from "./Live2DWindow";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Live2DWindow />
  </React.StrictMode>
);
