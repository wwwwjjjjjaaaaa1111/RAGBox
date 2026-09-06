/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Microsoft YaHei", "微软雅黑", "PingFang SC", "Noto Sans SC", "ui-sans-serif", "system-ui", "sans-serif"],
        headline: ["Microsoft YaHei", "微软雅黑", "PingFang SC", "Noto Sans SC", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
