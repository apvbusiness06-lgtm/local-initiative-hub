// Server-side QR: render to an inline SVG string so voucher codes are in the
// SSR HTML (printable, no client JS), matching the "results are in the HTML"
// posture used elsewhere.
import QRCode from "qrcode";

export async function qrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" });
}
