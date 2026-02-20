import Phaser from "phaser";
import "./style.css";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { RunScene } from "./scenes/RunScene";
import { yandexGamesSdk } from "./sdk/yandexGamesSdk";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#050816",
  scene: [BootScene, MenuScene, RunScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  }
});

if (typeof window !== "undefined") (window as unknown as { game: Phaser.Game }).game = game;
const detachSoundSync = yandexGamesSdk.connectGameSound(game);

window.addEventListener("resize", () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

window.addEventListener("beforeunload", () => {
  detachSoundSync();
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
window.addEventListener("selectstart", (event) => {
  event.preventDefault();
});
window.addEventListener("dragstart", (event) => {
  event.preventDefault();
});
