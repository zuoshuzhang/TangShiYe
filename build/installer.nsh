; ============================================================
; 自定义 NSIS 安装脚本
;
; 解决的问题：安装时弹「TangShiYe 无法关闭。请手动关闭它，然后单击重试以继续」
;
; 根因（读 node_modules/app-builder-lib/templates/nsis/include/
;      allowOnlyOneInstallerInstance.nsh 得出）：
;   默认 _CHECK_APP_RUNNING 先发 WM_CLOSE 做优雅关闭，再重试两次，最后才 /F。
;   本应用是「托盘常驻、无主窗口」的形态，收不到 WM_CLOSE，进程根本不理。
;   加上 Electron 是多进程（main/gpu/renderer/utility 都叫同一个 exe），
;   逐个重试很容易超过 2 次上限 → 直接弹「无法关闭」框。
;
; 处理：覆盖默认宏，fork 前直接 /F 强杀整棵进程树。
; ============================================================

!macro customInit
  ; 安装器一启动就先把旧实例请走（用户此时还在看欢迎页，感知不到）
  DetailPrint "正在检查并关闭已运行的 TangShiYe..."
  nsExec::Exec 'taskkill /F /IM "TangShiYe.exe" /T'
  Pop $0
  Sleep 600
!macroend

!macro customCheckAppRunning
  ; 覆盖 electron-builder 的 CHECK_APP_RUNNING 默认实现（见文件头说明）
  DetailPrint "正在关闭已运行的 TangShiYe..."
  nsExec::Exec 'taskkill /F /IM "TangShiYe.exe" /T'
  Pop $0
  Sleep 800

  ; Electron 子进程可能刚被父进程拉起，再补一刀
  nsExec::Exec 'taskkill /F /IM "TangShiYe.exe" /T'
  Pop $0
  Sleep 400
!macroend

!macro customUnInstall
  ; 卸载前同样清干净，否则文件占用会导致卸载残留
  nsExec::Exec 'taskkill /F /IM "TangShiYe.exe" /T'
  Pop $0
  Sleep 500
!macroend
