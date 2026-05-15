{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: {
    devShells.x86_64-linux.default = nixpkgs.legacyPackages.x86_64-linux.mkShell {
      packages = with nixpkgs.legacyPackages.x86_64-linux; [
        rustup
        wasm-pack
        bun
        cargo-watch
        cargo-edit       # `cargo upgrade` for bumping Cargo.toml versions
        cargo-outdated   # `cargo outdated` for spotting available upgrades
      ];
    };
  };
}
