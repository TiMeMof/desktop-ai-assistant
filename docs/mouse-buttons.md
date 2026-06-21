# Mouse Side Button Binding

v1 supports native mouse side button binding on Ubuntu X11.

Open Settings, then use the `Mouse side button` section:

- Enable mouse side button trigger.
- Keep the default `Button8`, or click `Record` and press a side button.
- Keep `Consume event` enabled if you do not want browsers to also navigate back.

The side button triggers the current action selected in the main bubble, the same as the keyboard shortcut.

Unsupported platforms should map a mouse side button to the app keyboard shortcut with OS-level tools:

- Windows: AutoHotkey, Logitech Options, Razer Synapse, Microsoft Mouse and Keyboard Center, or vendor driver.
- macOS: BetterTouchTool, Karabiner-Elements, SteerMouse, or vendor driver.
- Ubuntu Wayland: compositor support varies. Prefer desktop environment shortcut settings or `input-remapper` when supported.

Default app shortcut:

- Windows/Linux: `Ctrl+Shift+Space`
- macOS: `Command+Shift+Space`
