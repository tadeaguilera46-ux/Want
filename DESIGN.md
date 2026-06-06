# Design System — WANT

## Product Context
- **What this is:** Sistema operativo SaaS para restaurantes — gestiona mesas, órdenes, staff, menú, stock e integración de pagos
- **Who it's for:** Dueños de restaurantes (panel admin, desktop) y su equipo operativo (kitchen, bar, runner, cashier — tablet/mobile)
- **Space/industry:** Restaurant tech SaaS, Latin America
- **Project type:** Dashboard / web app operativo

## Memorable Thing
"Moderno y rápido, como las mejores apps que conozco" — al nivel de Notion, Stripe, Linear.

## Aesthetic Direction
- **Direction:** Luxury Minimal
- **Decoration level:** Minimal — micro-borders y sombras de 1-2px. Las cards no "saltan". El fondo y las superficies comparten el mismo warm white.
- **Mood:** Como una mesa bien puesta en un restaurante de calidad: todo en su lugar, nada gritando, pero todo precisamente elegante.
- **Key insight:** Cada SaaS de restaurantes diseña para el mozo parado con una tablet. WANT lo usa el dueño sentado en su computadora — necesita la sofisticación de Notion o Linear, no los botones enormes de Toast.

## Typography
- **Display/Hero:** Cabinet Grotesk (Fontshare) — geométrica, editorial, letter-spacing negativo en tamaños grandes. Inusual para restaurant tech = diferenciador inmediato.
- **Body/UI:** Satoshi (Fontshare) — limpia, moderna, geométrica. Para todo lo funcional: botones, labels, tablas, navegación.
- **Data/Tables:** Satoshi con `font-variant-numeric: tabular-nums`
- **Loading:** `https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700,500,400&f[]=satoshi@700,500,400,300&display=swap`
- **Scale:** xs(11px) sm(12px) base(14px) md(15px) lg(18px) xl(22px) 2xl(28px) 3xl(36px)

## Color
- **Approach:** Restrained — un acento, todo lo demás neutral. El color es un evento, no un fondo.
- **Background:** `#F9F8F6` — warm white, no beige. Apenas tibio. Como papel de calidad.
- **Surface/Cards:** `#FFFFFF` — blanco puro, un nivel por encima del background.
- **Surface-2:** `#F5F4F1` — hover states, inputs, filas activas.
- **Border:** `#E8E6E0` — borde cálido muy claro, delimita sin gritar.
- **Border strong:** `#C8C6BE` — hover de bordes, estados activos.
- **Text primary:** `#141412` — near-black cálido.
- **Text muted:** `#6F6E66` — warm gray.
- **Text faint:** `#A8A69E` — placeholders, metadata.
- **Sidebar:** `#141412` — la única superficie oscura del producto. Sidebar admin.
- **Accent:** `#C8922A` — amber dorado. Solo para: punto activo en nav, focus ring en inputs, UN botón outline por pantalla. En ningún otro contexto.
- **Success:** `#2E7D52` / light `#DCFCE7`
- **Danger:** `#C0392B` / light `#FEE2E0`
- **Warning:** `#B45309` / light `#FEF3C7`

## Button System — Ghost Philosophy
Fondo de botones = mismo color que la página. Solo el borde y el texto cambian.

- **Ghost (default):** `bg: #F9F8F6, border: #E8E6E0, text: #141412`
- **Ghost hover:** `bg: #F5F4F1, border: #C8C6BE`
- **Primary (UN solo por pantalla):** `bg: #141412, border: #141412, text: #F9F8F6`
- **Accent outline:** `bg: #F9F8F6, border: #C8922A, text: #C8922A`
- **Danger:** `bg: #F9F8F6, border: #E8E6E0, text: #C0392B` → hover: `bg: #FEE2E0, border: #C0392B`

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (no cramped, no spacious — es una herramienta operativa)
- **Scale:** 2(2px) 4(4px) 8(8px) 12(12px) 16(16px) 20(20px) 24(24px) 32(32px) 48(48px)

## Layout
- **Approach:** Grid-disciplined — columnas estrictas, alineación predecible
- **Sidebar:** Fixed 240px, dark (#141412), siempre visible en desktop
- **Max content width:** 1400px
- **Border radius:** sm(4px) md(6px) lg(10px) full(9999px)
- **Cards:** `border-radius: 10px, border: 1px solid #E8E6E0, background: #FFFFFF`

## Motion
- **Approach:** Minimal-functional — solo transiciones que ayudan a entender cambios de estado
- **Easing:** enter: ease-out / exit: ease-in / color: linear
- **Duration:** micro(100ms) short(150ms) medium(200ms)
- **No entrance animations en datos** — las tablas y cards aparecen directamente. Solo login y modals tienen animación de entrada.

## Sidebar Design
El sidebar dark es el único elemento oscuro del producto. Crea contraste visible entre navegación y área de trabajo — como las maderas oscuras contra los manteles blancos de un restaurante de calidad.
- Background: `#141412`
- Text: `rgba(249,248,246,1)` active / `rgba(249,248,246,0.5)` muted
- Nav item active: `bg: rgba(249,248,246,0.1), border: rgba(249,248,246,0.08)`
- Active indicator: punto amber `#C8922A` al final del item activo
- User chip: bottom, mismo estilo que nav item activo

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-06 | Cabinet Grotesk + Satoshi (Fontshare) | Inusual para restaurant tech, crea diferenciación inmediata. Anti-convergencia vs. Inter/Plus Jakarta Sans previos. |
| 2026-06-06 | Warm white #F9F8F6 base + ghost buttons | "Fondo y botones del mismo color" — usuario pidió explícitamente que el fondo de botones/cards no cambie del fondo de página. |
| 2026-06-06 | Sidebar dark #141412 único | Contraste nav/contenido sin oscurecer toda la UI. Inspirado en Notion sidebar. |
| 2026-06-06 | Acento amber #C8922A restringido | Un solo acento visible a la vez. Nunca como fondo de cards. Solo estado activo + focus. |
| 2026-06-06 | Border-radius 6px (md) | Eliminado el radius de 16px que daba sensación "juguete". 6px es preciso sin ser frío. |
