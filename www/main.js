import { app } from "../../scripts/app.js"
import { ComfyButtonGroup } from "../../scripts/ui/components/buttonGroup.js"
import { ComfyButton } from "../../scripts/ui/components/button.js"

app.registerExtension({
  name: "thot.live-preview",
  async setup() {
    // Create menu button if menu exists
    if (app.menu?.settingsGroup) {
      // Import the button module
      // Create menu button
      const menuButton = new ComfyButton({
        icon: "grid",
        action: () => window.open("extensions/comfy-live-preview/index.html", "_blank"),
        tooltip: "Live Viewer",
        content: "Live Viewer"
      })

      const group = new ComfyButtonGroup(menuButton)

      app.menu?.settingsGroup.element.after(group.element)
    }
  }
})
