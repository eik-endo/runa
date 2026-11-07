export const DICE_COLORS: { name: string; hex: string }[] = [
  { name: "Garança", hex: "#b8402f" },
  { name: "Ísatis", hex: "#3c6db3" },
  { name: "Musgo", hex: "#5d8a47" },
  { name: "Âmbar", hex: "#d99a2b" },
  { name: "Osso", hex: "#e6dcc6" },
  { name: "Ferro", hex: "#4b5563" },
  { name: "Urze", hex: "#7c4a8c" },
  { name: "Fiorde", hex: "#2f8a87" },
];

export const DEFAULT_DICE_COLOR = DICE_COLORS[0].hex;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}
