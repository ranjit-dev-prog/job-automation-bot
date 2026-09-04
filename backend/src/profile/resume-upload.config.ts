import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const resumeUploadOptions = {
  storage: diskStorage({
    destination: join(process.cwd(), 'uploads', 'resumes'),
    filename: (_req, file, callback) => {
      const ext = extname(file.originalname).toLowerCase();
      callback(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, callback: (error: Error | null, accept: boolean) => void) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return callback(new BadRequestException('Only PDF, DOC, or DOCX resumes are allowed'), false);
    }
    callback(null, true);
  },
};
