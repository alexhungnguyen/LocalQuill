/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        prose: [
          "Iowan Old Style",
          "Apple Garamond",
          "Baskerville",
          "Times New Roman",
          "Droid Serif",
          "Times",
          "serif",
        ],
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        ink: {
          50: "#f5f3ee",
          100: "#e7e2d6",
          200: "#cdc5b1",
          300: "#a89e85",
          400: "#7d735c",
          500: "#574e3d",
          600: "#3d362a",
          700: "#2a2520",
          800: "#1c1916",
          900: "#121110",
          950: "#0a0908",
        },
        accent: {
          400: "#d4a574",
          500: "#c08a4f",
          600: "#a06d35",
        },
      },
    },
  },
  plugins: [],
};
