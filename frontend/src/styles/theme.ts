export const lightTheme = {
  mode: "light" as const,
  colors: {
    background: "#FFFFFF",
    surface: "#F5F5F5",
    surfaceHover: "#EEEEEE",
    text: {
      primary: "#1A1A1A",
      secondary: "#666666",
      disabled: "#AAAAAA",
    },
    primary: "#3182F6", // Toss 블루
    primaryHover: "#1B64DA",
    danger: "#F04452",
    success: "#2BD67E",
    warning: "#FF9F00",
    border: "#E5E5E5",
    shadow: "rgba(0, 0, 0, 0.08)",
    // 카테고리 컬러 (토스 POS 스타일)
    category: {
      coffee: "#8B6544",
      beverage: "#3182F6",
      bakery: "#FF9F00",
      default: "#666666",
    },
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px",
  },
  borderRadius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
  },
  fontSize: {
    xs: "12px",
    sm: "14px",
    md: "16px",
    lg: "20px",
    xl: "24px",
    xxl: "32px",
  },
};

export type AppTheme = Omit<typeof lightTheme, "mode"> & {
  mode: "light" | "dark";
};

export const darkTheme: AppTheme = {
  ...lightTheme,
  mode: "dark",
  colors: {
    ...lightTheme.colors,
    background: "#1A1A1A",
    surface: "#2A2A2A",
    surfaceHover: "#333333",
    text: {
      primary: "#F0F0F0",
      secondary: "#A0A0A0",
      disabled: "#666666",
    },
    border: "#3A3A3A",
    shadow: "rgba(0, 0, 0, 0.3)",
    category: {
      coffee: "#C4956A",
      beverage: "#5BA0F8",
      bakery: "#FFB84D",
      default: "#999999",
    },
  },
};

