import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Format a view count number to a human-readable string
 * e.g., 1200000 -> "1.2M", 123456 -> "123K", 1234 -> "1,234"
 */
export function formatViewCount(count: number | string): string {
    // Handle edge cases
    if (count === "Saved" || count === "0" || count === 0 || count === "") {
        return "Saved";
    }
    
    const num = typeof count === "string" ? parseInt(count, 10) : count;
    
    if (isNaN(num) || num < 0) {
        return "Saved";
    }
    
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
    }
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
    }
    
    return num.toLocaleString();
}
