# Loaded by zsh during VHS recording (via ZDOTDIR=docs/demo).
# Not your interactive shell config — this is a recording prop.

# Point starship at the demo-only config so the prompt stays minimal.
export STARSHIP_CONFIG="$PWD/docs/demo/starship.toml"

# Syntax highlighting + autosuggestions give the recording a "real
# dev terminal" feel. Brew paths — install with:
#   brew install zsh-syntax-highlighting zsh-autosuggestions starship
source "$(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
source "$(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh"

eval "$(starship init zsh)"
