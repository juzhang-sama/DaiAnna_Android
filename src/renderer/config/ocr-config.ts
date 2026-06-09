/** PDF 文本直提的最小有效字符数，低于此值视为扫描件 */
export const MIN_TEXT_LENGTH = 50;

/** 支持的图片文件扩展名 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'];

/** 判断文件是否为图片 */
export function isImageFile(file: File): boolean {
  if (file.type.toLowerCase().startsWith('image/')) return true;
  const name = file.name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** 上传组件的 accept 字符串 */
export const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.bmp,.tiff,.tif';
