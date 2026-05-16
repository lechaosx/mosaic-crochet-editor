// Minimal declaration for the Vite-injected build constant used in dev.ts.
interface ImportMeta {
    readonly env: { readonly DEV: boolean };
}

// btoa/atob are universal globals (browsers, Node 16+, Deno) but live in
// lib.dom.d.ts which we intentionally exclude. Declare them here.
declare function btoa(data: string): string;
declare function atob(data: string): string;
