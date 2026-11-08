import WebKit
import SafariServices

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "app.uzero.Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {
    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
#if os(iOS)
        webView.scrollView.isScrollEnabled = true
#endif
        webView.configuration.userContentController.add(self, name: "controller")
        webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(iOS) && !targetEnvironment(macCatalyst)
        if #available(iOS 26.2, *) {
            webView.evaluateJavaScript("show('ios', null, true)")
        } else {
            webView.evaluateJavaScript("show('ios', null, false)")
        }
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac', null, true)")
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            guard let state = state, error == nil else { return }
            DispatchQueue.main.async {
                self?.webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)")
            }
        }
#endif
    }

    private func settingsCompleted(_ error: Error?) {
        guard error != nil else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("settingsError()")
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.isFileURL == true,
              let action = message.body as? String, action == "open-preferences" else { return }
#if os(macOS)
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { [weak self] error in
            self?.settingsCompleted(error)
        }
#elseif os(iOS) && !targetEnvironment(macCatalyst)
        if #available(iOS 26.2, *) {
            SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier]) { [weak self] error in
                self?.settingsCompleted(error)
            }
        }
#endif
    }
}
