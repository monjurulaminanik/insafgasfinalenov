/// <reference types="vite/client" />

import "react";

declare module "react" {
  interface DetailsHTMLAttributes<T> {
    defaultOpen?: boolean;
  }
}
