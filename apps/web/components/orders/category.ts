import { Coffee, Footprints, Headphones, Package, Shirt, type LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ui/glyph-tile";

export function categoryMeta(category: string | null | undefined): { icon: LucideIcon; tone: Tone; label: string } {
  switch (category) {
    case "footwear":
      return { icon: Footprints, tone: "sunset", label: "Footwear" };
    case "apparel":
      return { icon: Shirt, tone: "violet", label: "Apparel" };
    case "electronics":
      return { icon: Headphones, tone: "sky", label: "Electronics" };
    case "home":
      return { icon: Coffee, tone: "teal", label: "Home" };
    default:
      return { icon: Package, tone: "slate", label: "Item" };
  }
}
