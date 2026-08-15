// pdfkit ships untyped CommonJS; without this stub tsc crawls its dist JS
// (and fontkit's) and infers a broken partial PDFDocument class.
declare module 'pdfkit' {
  const PDFDocument: any;
  export default PDFDocument;
}
