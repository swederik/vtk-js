//VTK::System::Dec

/*=========================================================================

  Program:   Visualization Toolkit
  Module:    vtkMultiVolumeFS.glsl

  Copyright (c) Ken Martin, Will Schroeder, Bill Lorensen
  All rights reserved.
  See Copyright.txt or http://www.kitware.com/Copyright.htm for details.

     This software is distributed WITHOUT ANY WARRANTY; without even
     the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
     PURPOSE.  See the above copyright notice for more information.

=========================================================================*/
// the output of this shader
//VTK::Output::Dec

varying vec3 vertexVCVSOutput;

//VTK::NumVolumes

// first declare the settings from the mapper
// that impact the code paths in here

// always set vtkNumComponents 1,2,3,4
//VTK::NumComponents

// Array listing the number of components per volume
uniform int numComps[vtkNumVolumes];

// possibly define vtkUseTrilinear
//VTK::TrilinearOn

// possibly define vtkIndependentComponents
//VTK::IndependentComponentsOn

// Define the blend mode to use
#define vtkMultiVolumeBlendMode //VTK::MultiVolumeBlendMode

// define vtkLightComplexity
//VTK::LightComplexity
#if vtkLightComplexity > 0
uniform float vSpecularPower[vtkNumVolumes];
uniform float vAmbient[vtkNumVolumes];
uniform float vDiffuse[vtkNumVolumes];
uniform float vSpecular[vtkNumVolumes];
//VTK::Light::Dec
#endif

// possibly define vtkGradientOpacityOn
//VTK::GradientOpacityOn
#ifdef vtkGradientOpacityOn
uniform float goscale0;
uniform float goshift0;
uniform float gomin0;
uniform float gomax0;
#if defined(vtkIndependentComponentsOn) && (vtkNumComponents > 1)
uniform float goscale1;
uniform float goshift1;
uniform float gomin1;
uniform float gomax1;
#if vtkNumComponents >= 3
uniform float goscale2;
uniform float goshift2;
uniform float gomin2;
uniform float gomax2;
#endif
#if vtkNumComponents >= 4
uniform float goscale3;
uniform float goshift3;
uniform float gomin3;
uniform float gomax3;
#endif
#endif
#endif

// camera values
uniform float camThick;
uniform float camNear;
uniform float camFar;
uniform int cameraParallel;

// values describing the volume geometry
uniform vec3 vOriginVCArr[vtkNumVolumes];
uniform vec3 vSpacingArr[vtkNumVolumes];
uniform ivec3 volumeDimensionsArr[vtkNumVolumes]; // 3d texture dimensions
uniform vec3 vPlaneNormal0Arr[vtkNumVolumes];
uniform float vPlaneDistance0Arr[vtkNumVolumes];
uniform vec3 vPlaneNormal1Arr[vtkNumVolumes];
uniform float vPlaneDistance1Arr[vtkNumVolumes];
uniform vec3 vPlaneNormal2Arr[vtkNumVolumes];
uniform float vPlaneDistance2Arr[vtkNumVolumes];
uniform vec3 vPlaneNormal3Arr[vtkNumVolumes];
uniform float vPlaneDistance3Arr[vtkNumVolumes];
uniform vec3 vPlaneNormal4Arr[vtkNumVolumes];
uniform float vPlaneDistance4Arr[vtkNumVolumes];
uniform vec3 vPlaneNormal5Arr[vtkNumVolumes];
uniform float vPlaneDistance5Arr[vtkNumVolumes];

// opacity and color textures
uniform sampler2D otextureArr[vtkNumVolumes];
uniform float oshift0Arr[vtkNumVolumes];
uniform float oscale0Arr[vtkNumVolumes];
uniform sampler2D ctextureArr[vtkNumVolumes];
uniform float cshift0Arr[vtkNumVolumes];
uniform float cscale0Arr[vtkNumVolumes];

// jitter texture
uniform sampler2D jtexture;

// some 3D texture values
uniform float sampleDistance;
uniform vec3 vVCToIJKArr[vtkNumVolumes];

// the heights defined below are the locations
// for the up to four components of the tfuns
// the tfuns have a height of 2XnumComps pixels so the
// values are computed to hit the middle of the two rows
// for that component
#ifdef vtkIndependentComponentsOn
#if vtkNumComponents == 2
uniform float mix0;
uniform float mix1;
#define height0 0.25
#define height1 0.75
#endif
#if vtkNumComponents == 3
uniform float mix0;
uniform float mix1;
uniform float mix2;
#define height0 0.17
#define height1 0.5
#define height2 0.83
#endif
#if vtkNumComponents == 4
uniform float mix0;
uniform float mix1;
uniform float mix2;
uniform float mix3;
#define height0 0.125
#define height1 0.375
#define height2 0.625
#define height3 0.875
#endif
#endif

#if vtkNumComponents >= 2
uniform float oshift1;
uniform float oscale1;
uniform float cshift1;
uniform float cscale1;
#endif
#if vtkNumComponents >= 3
uniform float oshift2;
uniform float oscale2;
uniform float cshift2;
uniform float cscale2;
#endif
#if vtkNumComponents >= 4
uniform float oshift3;
uniform float oscale3;
uniform float cshift3;
uniform float cscale3;
#endif

// declaration for intermixed geometry
//VTK::ZBuffer::Dec

// Lighting values
//VTK::Light::Dec

//=======================================================================
uniform highp sampler3D scalarTexture[vtkNumVolumes];

vec4 getTextureValue(vec3 pos, int volIdx)
{
  vec4 tmp = texture(scalarTexture, pos);
  if (numComp == 1) {
    tmp.a = tmp.r;
  } else if (numComp == 2) {
    tmp.a = tmp.g;
  } else if (numComp == 3) {
    tmp.a = length(tmp.rgb);
  }
  return tmp;
}

//=======================================================================
// compute the normal and gradient magnitude for a position
vec4 computeNormal(vec3 pos, float scalar, vec3 tstep, int volIdx)
{
  vec4 result;

  result.x = getTextureValue(pos + vec3(tstep.x, 0.0, 0.0), volIdx).a - scalar;
  result.y = getTextureValue(pos + vec3(0.0, tstep.y, 0.0), volIdx).a - scalar;
  result.z = getTextureValue(pos + vec3(0.0, 0.0, tstep.z), volIdx).a - scalar;

  // divide by spacing
  result.xyz /= vSpacing;

  result.w = length(result.xyz);

  // rotate to View Coords
  result.xyz =
  result.x * vPlaneNormal0 +
  result.y * vPlaneNormal2 +
  result.z * vPlaneNormal4;

  if (result.w > 0.0) {
    result.xyz /= result.w;
  }
  return result;
}

//=======================================================================
// compute the normals and gradient magnitudes for a position
// for independent components
mat4 computeMat4Normal(vec3 pos, vec4 tValue, vec3 tstep, int volIdx)
{
  mat4 result;
  vec4 distX = getTextureValue(pos + vec3(tstep.x, 0.0, 0.0), volIdx) - tValue;
  vec4 distY = getTextureValue(pos + vec3(0.0, tstep.y, 0.0), volIdx) - tValue;
  vec4 distZ = getTextureValue(pos + vec3(0.0, 0.0, tstep.z), volIdx) - tValue;

  // divide by spacing
  distX /= vSpacing.x;
  distY /= vSpacing.y;
  distZ /= vSpacing.z;

  mat3 rot;
  rot[0] = vPlaneNormal0;
  rot[1] = vPlaneNormal2;
  rot[2] = vPlaneNormal4;

  result[0].xyz = vec3(distX.r, distY.r, distZ.r);
  result[0].a = length(result[0].xyz);
  result[0].xyz *= rot;
  if (result[0].w > 0.0)
  {
    result[0].xyz /= result[0].w;
  }

  result[1].xyz = vec3(distX.g, distY.g, distZ.g);
  result[1].a = length(result[1].xyz);
  result[1].xyz *= rot;
  if (result[1].w > 0.0)
  {
    result[1].xyz /= result[1].w;
  }

    // optionally compute the 3rd component
    #if vtkNumComponents >= 3
  result[2].xyz = vec3(distX.b, distY.b, distZ.b);
  result[2].a = length(result[2].xyz);
  result[2].xyz *= rot;
  if (result[2].w > 0.0)
  {
    result[2].xyz /= result[2].w;
  }
    #endif

    // optionally compute the 4th component
    #if vtkNumComponents >= 4
  result[3].xyz = vec3(distX.a, distY.a, distZ.a);
  result[3].a = length(result[3].xyz);
  result[3].xyz *= rot;
  if (result[3].w > 0.0)
  {
    result[3].xyz /= result[3].w;
  }
    #endif

  return result;
}

//=======================================================================
// Given a normal compute the gradient opacity factors
//
float computeGradientOpacityFactor(
vec4 normal, float goscale, float goshift, float gomin, float gomax)
{
  #if defined(vtkGradientOpacityOn)
  return clamp(normal.a*goscale + goshift, gomin, gomax);
  #else
  return 1.0;
  #endif
}

  #if vtkLightComplexity > 0
void applyLighting(inout vec3 tColor, vec4 normal)
{
  vec3 diffuse = vec3(0.0, 0.0, 0.0);
  vec3 specular = vec3(0.0, 0.0, 0.0);
  //VTK::Light::Impl
  tColor.rgb = tColor.rgb*(diffuse*vDiffuse + vAmbient) + specular*vSpecular;
}
  #endif

//=======================================================================
// Given a texture value compute the color and opacity
//
vec4 getColorForValue(vec4 tValue, vec3 posIS, vec3 tstep, int volIdx)
{
  // compute the normal and gradient magnitude if needed
  // We compute it as a vec4 if possible otherwise a mat4
  //
  vec4 goFactor = vec4(1.0,1.0,1.0,1.0);

  // compute the normal vectors as needed
  #if (vtkLightComplexity > 0) || defined(vtkGradientOpacityOn)
    //TODO[multivolume] Only add these as necessary
    // #if defined(vtkNumComponents > 1)
      if (numComp > 1) {
        mat4 normalMat = computeMat4Normal(posIS, tValue, tstep, volIdx);
        vec4 normal0 = normalMat[0];
        vec4 normal1 = normalMat[1];
      }

      if (numComp > 2) {
        vec4 normal2 = normalMat[2];
      }

      if (numComp > 3) {
        vec4 normal3 = normalMat[3];
      }
    //#else
      vec4 normal0 = computeNormal(posIS, tValue.a, tstep, volIdx);
    //#endif
  #endif

  // compute gradient opacity factors as needed
  #if defined(vtkGradientOpacityOn)
  goFactor.x =
  computeGradientOpacityFactor(normal0, goscale0, goshift0, gomin0, gomax0);
  #if defined(vtkIndependentComponentsOn) && (vtkNumComponents > 1)
  goFactor.y =
  computeGradientOpacityFactor(normal1, goscale1, goshift1, gomin1, gomax1);
  #if vtkNumComponents > 2
  goFactor.z =
  computeGradientOpacityFactor(normal2, goscale2, goshift2, gomin2, gomax2);
  #if vtkNumComponents > 3
  goFactor.w =
  computeGradientOpacityFactor(normal3, goscale3, goshift3, gomin3, gomax3);
  #endif
  #endif
  #endif
  #endif

  // single component is always independent
  #if vtkNumComponents == 1
  vec4 tColor = texture2D(ctexture, vec2(tValue.r * cscale0 + cshift0, 0.5));
  tColor.a = goFactor.x*texture2D(otexture, vec2(tValue.r * oscale0 + oshift0, 0.5)).r;
  #endif

  #if defined(vtkIndependentComponentsOn) && vtkNumComponents >= 2
  vec4 tColor = mix0*texture2D(ctexture, vec2(tValue.r * cscale0 + cshift0, height0));
  tColor.a = goFactor.x*mix0*texture2D(otexture, vec2(tValue.r * oscale0 + oshift0, height0)).r;
  vec3 tColor1 = mix1*texture2D(ctexture, vec2(tValue.g * cscale1 + cshift1, height1)).rgb;
  tColor.a += goFactor.y*mix1*texture2D(otexture, vec2(tValue.g * oscale1 + oshift1, height1)).r;
  #if vtkNumComponents >= 3
  vec3 tColor2 = mix2*texture2D(ctexture, vec2(tValue.b * cscale2 + cshift2, height2)).rgb;
  tColor.a += goFactor.z*mix2*texture2D(otexture, vec2(tValue.b * oscale2 + oshift2, height2)).r;
  #if vtkNumComponents >= 4
  vec3 tColor3 = mix3*texture2D(ctexture, vec2(tValue.a * cscale3 + cshift3, height3)).rgb;
  tColor.a += goFactor.w*mix3*texture2D(otexture, vec2(tValue.a * oscale3 + oshift3, height3)).r;
  #endif
  #endif

  #else // then not independent

  #if vtkNumComponents == 2
  float lum = tValue.r * cscale0 + cshift0;
  float alpha = goFactor.x*texture2D(otexture, vec2(tValue.a * oscale1 + oshift1, 0.5)).r;
  vec4 tColor = vec4(lum, lum, lum, alpha);
  #endif
  #if vtkNumComponents == 3
  vec4 tColor;
  tColor.r = tValue.r * cscale0 + cshift0;
  tColor.g = tValue.g * cscale1 + cshift1;
  tColor.b = tValue.b * cscale2 + cshift2;
  tColor.a = goFactor.x*texture2D(otexture, vec2(tValue.a * oscale0 + oshift0, 0.5)).r;
  #endif
  #if vtkNumComponents == 4
  vec4 tColor;
  tColor.r = tValue.r * cscale0 + cshift0;
  tColor.g = tValue.g * cscale1 + cshift1;
  tColor.b = tValue.b * cscale2 + cshift2;
  tColor.a = goFactor.x*texture2D(otexture, vec2(tValue.a * oscale3 + oshift3, 0.5)).r;
  #endif
  #endif // dependent

  // apply lighting if requested as appropriate
  #if vtkLightComplexity > 0
  applyLighting(tColor.rgb, normal0);
  #if defined(vtkIndependentComponentsOn) && vtkNumComponents >= 2
  applyLighting(tColor1, normal1);
  #if vtkNumComponents >= 3
  applyLighting(tColor2, normal2);
  #if vtkNumComponents >= 4
  applyLighting(tColor3, normal3);
  #endif
  #endif
  #endif
  #endif

  // perform final independent blend as needed
  #if defined(vtkIndependentComponentsOn) && vtkNumComponents >= 2
  tColor.rgb += tColor1;
  #if vtkNumComponents >= 3
  tColor.rgb += tColor2;
  #if vtkNumComponents >= 4
  tColor.rgb += tColor3;
  #endif
  #endif
  #endif

  return tColor;
}

//=======================================================================
// Apply the specified blend mode operation along the ray's path.
//
void applyBlend(vec3 posIS, vec3 endIS, float sampleDistanceIS, vec3 tdims)
{
  vec3 tstep = 1.0/tdims;

  // start slightly inside and apply some jitter
  vec3 delta = endIS - posIS;
  vec3 stepIS = normalize(delta) * sampleDistanceIS;
  float raySteps = length(delta) / sampleDistanceIS;

  // avoid 0.0 jitter
  float jitter = 0.01 + 0.99*texture2D(jtexture, gl_FragCoord.xy/32.0).r;
  float stepsTraveled = jitter;

  // local vars for the loop
  vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
  vec4 tValue;
  vec4 tColor;

  // Perform initial step at the volume boundary
  // compute the scalar
  tValue = getTextureValue(posIS, 0);

  // COMPOSITE_BLEND
  // now map through opacity and color
  tColor = getColorForValue(tValue, posIS, tstep, 0);

  // handle very thin volumes
  if (raySteps <= 1.0) {
    tColor.a = 1.0 - pow(1.0 - tColor.a, raySteps);
    gl_FragData[0] = tColor;
    return;
  }

  tColor.a = 1.0 - pow(1.0 - tColor.a, jitter);
  color = vec4(tColor.rgb*tColor.a, tColor.a);
  posIS += (jitter*stepIS);

  int maxNumSamples = //VTK::MaximumSamplesValue;
  for (int i = 0; i < maxNumSamples ; ++i) {
    if (stepsTraveled + 1.0 >= raySteps) {
      break;
    }

    // compute the scalar
    tValue = getTextureValue(posIS, 0);

    // At each step, map texture value through opacity and color
    // and then mix colors across volumes
    vec4 colorAtStep;
    for (int n = 0; n < vtkNumVolumes ; ++n)
    {
      tColor = getColorForValue(tValue, posIS, tstep, n);

      float mix = (1.0 - color.a);

      colorAtStep = colorAtStep + vec4(tColor.rgb*tColor.a, tColor.a)*mix;
    }

    // Then mix the color from the step along the ray as usual
    float mix = (1.0 - colorAtStep.a);
    color = color + vec4(colorAtStep.rgb*colorAtStep.a, colorAtStep.a)*mix;

    stepsTraveled++;
    posIS += stepIS;
    if (color.a > 0.99) { color.a = 1.0; break; }
  }

  if (color.a < 0.99 && (raySteps - stepsTraveled) > 0.0) {
    posIS = endIS;

    // compute the scalar
    tValue = getTextureValue(posIS, 0);

    // now map through opacity and color
    tColor = getColorForValue(tValue, posIS, tstep, 0);
    tColor.a = 1.0 - pow(1.0 - tColor.a, raySteps - stepsTraveled);

    float mix = (1.0 - color.a);
    color = color + vec4(tColor.rgb*tColor.a, tColor.a)*mix;
  }

  gl_FragData[0] = vec4(color.rgb/color.a, color.a);
}

//=======================================================================
// Compute a new start and end point for a given ray based
// on the provided bounded clipping plane (aka a rectangle)
void getRayPointIntersectionBounds(
vec3 rayPos, vec3 rayDir,
vec3 planeDir, float planeDist,
inout vec2 tbounds, vec3 vPlaneX, vec3 vPlaneY,
float vSize1, float vSize2)
{
  float result = dot(rayDir, planeDir);
  if (result == 0.0)
  {
    return;
  }
  result = -1.0 * (dot(rayPos, planeDir) + planeDist) / result;
  vec3 xposVC = rayPos + rayDir*result;
  vec3 vxpos = xposVC - vOriginVC;
  vec2 vpos = vec2(
  dot(vxpos, vPlaneX),
  dot(vxpos, vPlaneY));

  // on some apple nvidia systems this does not work
  // if (vpos.x < 0.0 || vpos.x > vSize1 ||
  //     vpos.y < 0.0 || vpos.y > vSize2)
  // even just
  // if (vpos.x < 0.0 || vpos.y < 0.0)
  // fails
  // so instead we compute a value that represents in and out
  //and then compute the return using this value
  float xcheck = max(0.0, vpos.x * (vpos.x - vSize1)); //  0 means in bounds
  float check = sign(max(xcheck, vpos.y * (vpos.y - vSize2))); //  0 means in bounds, 1 = out

  tbounds = mix(
  vec2(min(tbounds.x, result), max(tbounds.y, result)), // in value
  tbounds, // out value
  check);  // 0 in 1 out
}

//=======================================================================
// given a
// - ray direction (rayDir)
// - starting point (vertexVCVSOutput)
// - bounding planes of the volume
// - optionally depth buffer values
// - far clipping plane
// compute the start/end distances of the ray we need to cast
vec2 computeRayDistances(vec3 rayDir, vec3 tdims)
{
  vec2 dists = vec2(100.0 * camFar, -1.0);

  for (int n = 0; n < vtkNumVolumes ; ++n) {
    vec3 vPlaneNormal0 = vPlaneNormal0Arr[n];
    vec3 vPlaneNormal1 = vPlaneNormal1Arr[n];
    vec3 vPlaneNormal2 = vPlaneNormal2Arr[n];
    vec3 vPlaneNormal3 = vPlaneNormal3Arr[n];
    vec3 vPlaneNormal4 = vPlaneNormal4Arr[n];
    vec3 vPlaneNormal5 = vPlaneNormal5Arr[n];
    vec3 vSpacing = vSpacingArr[n];

    vec3 vSize = vSpacing*(tdims - 1.0);

    // all this is in View Coordinates
    getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
    vPlaneNormal0, vPlaneDistance0, dists, vPlaneNormal2, vPlaneNormal4,
    vSize.y, vSize.z);
    getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
    vPlaneNormal1, vPlaneDistance1, dists, vPlaneNormal2, vPlaneNormal4,
    vSize.y, vSize.z);
    getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
    vPlaneNormal2, vPlaneDistance2, dists, vPlaneNormal0, vPlaneNormal4,
    vSize.x, vSize.z);
    getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
    vPlaneNormal3, vPlaneDistance3, dists, vPlaneNormal0, vPlaneNormal4,
    vSize.x, vSize.z);
    getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
    vPlaneNormal4, vPlaneDistance4, dists, vPlaneNormal0, vPlaneNormal2,
    vSize.x, vSize.y);
    getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
    vPlaneNormal5, vPlaneDistance5, dists, vPlaneNormal0, vPlaneNormal2,
    vSize.x, vSize.y);
  }

  // do not go behind front clipping plane
  dists.x = max(0.0,dists.x);

  // do not go PAST far clipping plane
  float farDist = -camThick/rayDir.z;
  dists.y = min(farDist,dists.y);

  // Do not go past the zbuffer value if set
  // This is used for intermixing opaque geometry
  //VTK::ZBuffer::Impl

  return dists;
}

//=======================================================================
// Compute the index space starting position (pos) and end
// position
//
void computeIndexSpaceValues(out vec3 pos, out vec3 endPos, out float sampleDistanceIS, vec3 rayDir, vec2 dists)
{
  // TODO[multivolume]: Does GLSL have Infinity?
  float sampleDistanceIS = 1000;

  for (int n = 0; n < vtkNumVolumes ; ++n) {
    vec3 vPlaneNormal0 = vPlaneNormal0Arr[n];
    vec3 vPlaneNormal1 = vPlaneNormal1Arr[n];
    vec3 vPlaneNormal2 = vPlaneNormal2Arr[n];
    vec3 vPlaneNormal3 = vPlaneNormal3Arr[n];
    vec3 vPlaneNormal4 = vPlaneNormal4Arr[n];
    vec3 vPlaneNormal5 = vPlaneNormal5Arr[n];
    vec3 vOriginVC = vOriginVCArr[n];
    vec3 vVCToIJK = vVCToIJKArr[n];

    // compute starting and ending values in volume space
    pos = vertexVCVSOutput + dists.x*rayDir;
    pos = pos - vOriginVC;
    // convert to volume basis and origin
    pos = vec3(
      dot(pos, vPlaneNormal0),
      dot(pos, vPlaneNormal2),
      dot(pos, vPlaneNormal4));

    endPos = vertexVCVSOutput + dists.y*rayDir;
    endPos = endPos - vOriginVC;
    endPos = vec3(
      dot(endPos, vPlaneNormal0),
      dot(endPos, vPlaneNormal2),
      dot(endPos, vPlaneNormal4));

    float delta = length(endPos - pos);

    pos *= vVCToIJK;
    endPos *= vVCToIJK;

    float delta2 = length(endPos - pos);

    sampleDistanceIS = min(sampleDistanceIS, sampleDistance*delta2/delta);
  }
}

void main()
{
  vec3 rayDirVC;

  if (cameraParallel == 1) {
    // Camera is parallel, so the rayDir is just the direction of the camera.
    rayDirVC = vec3(0.0, 0.0, -1.0);
  } else {
    // camera is at 0,0,0 so rayDir for perspective is just the vc coord
    rayDirVC = normalize(vertexVCVSOutput);
  }

  vec3 tdims = vec3(volumeDimensions);

  // compute the start and end points for the ray
  vec2 rayStartEndDistancesVC = computeRayDistances(rayDirVC, tdims);

  // do we need to composite? aka does the ray have any length
  // If not, bail out early
  if (rayStartEndDistancesVC.y <= rayStartEndDistancesVC.x) {
    discard;
  }

  // IS = Index Space
  vec3 posIS;
  vec3 endIS;
  float sampleDistanceIS;
  computeIndexSpaceValues(posIS, endIS, sampleDistanceIS, rayDirVC, rayStartEndDistancesVC);

  // Perform the blending operation along the ray
  applyBlend(posIS, endIS, sampleDistanceIS, tdims);
}
