import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';

const isProduction = process.env.NODE_ENV === 'production';

export default [
  {
    input: 'src/app.ts',
    output: {
      file: 'app.js',
      format: 'es',
      sourcemap: true,
    },
    external: [
      /^https:\/\/cdn\.jsdelivr\.net\//,
    ],
    plugins: [
      replace({
        preventAssignment: true,
        values: isProduction ? { 'console.warn': '// console.warn' } : {},
      }),
      typescript({ tsconfig: './tsconfig.json' }),
      terser({ compress: { passes: 2 } }),
    ],
  },
  {
    input: 'src/html-book.ts',
    output: {
      file: 'html-book.js',
      format: 'iife',
      sourcemap: true,
    },
    plugins: [
      replace({
        preventAssignment: true,
        values: isProduction ? { 'console.warn': '// console.warn' } : {},
      }),
      typescript({ tsconfig: './tsconfig.json' }),
      terser({ compress: { passes: 2 } }),
    ],
  },
];
