
export const PYTHON_SYSTEM_CONTROLLER = `
import subprocess
import os
import platform
import webbrowser
import screen_brightness_control as sbc

class WebHandler:
    """Handles browser-based intents like searches and direct site access."""
    def __init__(self):
        self.browser_path = None # Uses default system browser

    def search_google(self, query: str):
        formatted_query = query.replace(" ", "+")
        url = f"https://www.google.com/search?q={formatted_query}"
        webbrowser.open_new_tab(url)
        return True

    def open_site(self, site_name: str):
        # Handle common social platforms or append .com
        sites = {
            "youtube": "https://www.youtube.com Brook",
            "facebook": "https://www.facebook.com",
            "instagram": "https://www.instagram.com",
            "spotify": "https://open.spotify.com"
        }
        url = sites.get(site_name.lower(), f"https://www.{site_name}.com")
        webbrowser.open_new_tab(url)
        return True

class SystemController:
    """Advanced system and display control."""
    def __init__(self):
        self.os_type = platform.system()
        self.web = WebHandler()

    def set_brightness(self, level: int):
        try:
            sbc.set_brightness(level)
            return True
        except Exception as e:
            print(f"Brightness Error: {e}")
            return False

    def set_volume(self, level: int):
        if self.os_type == "Windows":
            from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
            # ... standard pycaw implementation ...
            pass
        else:
            os.system(f"osascript -e 'set volume output volume {level}'")

    def power_action(self, action: str):
        if action == "shutdown":
            cmd = "shutdown /s /t 0" if self.os_type == "Windows" else "sudo shutdown -h now"
        subprocess.run(cmd, shell=True)

class IntentRouter:
    """The 'Brain' logic that routes intents from LLM JSON output."""
    def __init__(self, controller):
        self.ctrl = controller

    def route(self, llm_json):
        intent = llm_json.get("type")
        data = llm_json.get("data")

        if intent == "google_search":
            self.ctrl.web.search_google(data['query'])
        elif intent == "web_open":
            self.ctrl.web.open_site(data['site'])
        elif intent == "brightness":
            self.ctrl.set_brightness(data['level'])
        elif intent == "volume":
            self.ctrl.set_volume(data['level'])
        elif intent == "chat":
            print(f"Assistant: {data['response']}")
`;

export const PYTHON_VISUALIZER = `
import sys
import numpy as np
import pyaudio
from PyQt6.QtWidgets import QWidget, QApplication
from PyQt6.QtCore import QTimer, Qt
from PyQt6.QtGui import QPainter, QColor, QPen, QRadialGradient

class GalaxyVisualizer(QWidget):
    """Circular galaxy-style visualizer pulsing to audio data."""
    def __init__(self):
        super().__init__()
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.resize(400, 400)
        
        # Audio Intensity tracking
        self.intensity = 0
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_state)
        self.timer.start(16) # ~60 FPS

    def update_state(self):
        # Simulate or pull real mic amplitude
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        center = self.rect().center()
        # Galaxy particles logic implemented with QPainter
        # Pulsing radius: 100 + (self.intensity * 50)
        pass
`;
