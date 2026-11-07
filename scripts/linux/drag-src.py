#!/usr/bin/env python3
# 给测试用的拖拽源。xdotool 拉不动文件管理器里的图标，这个窗口可以真正发出 text/uri-list。
import sys
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk, GLib

uri = sys.argv[1]
win = Gtk.Window(title='dragsrc')
win.set_default_size(180, 90)
win.move(60, 80)
box = Gtk.EventBox()
box.add(Gtk.Label(label='DRAG'))
box.drag_source_set(
    Gdk.ModifierType.BUTTON1_MASK,
    [Gtk.TargetEntry.new('text/uri-list', 0, 0)],
    Gdk.DragAction.COPY,
)

def on_get(widget, context, data, info, time):
    data.set_uris([uri])

box.connect('drag-data-get', on_get)
win.add(box)
win.show_all()
GLib.timeout_add(25000, Gtk.main_quit)
Gtk.main()
