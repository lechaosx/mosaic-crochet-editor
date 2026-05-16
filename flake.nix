{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in {
      devShells.x86_64-linux.default = pkgs.mkShell {
        packages = with pkgs; [
          rustup
          wasm-pack
          bun
          cargo-watch
          cargo-edit       # `cargo upgrade` for bumping Cargo.toml versions
          cargo-outdated   # `cargo outdated` for spotting available upgrades
          playwright-driver.browsers   # E2E: ships a nixpkgs-linked chromium-headless-shell
        ];
        # Point Playwright at the nix-provided browser bundle; skip the
        # host-deps check (downloaded binaries don't link against system
        # libs on NixOS — but we never download because the path above
        # already satisfies Playwright's binary lookup).
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
      };
    };
}
