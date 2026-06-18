using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;
using RemoteLink.Api.Filters;
using RemoteLink.Api.Options;

namespace RemoteLink.Api.Controllers;

[ApiController]
[Route("api/files")]
public sealed class FilesController(IOptions<RemoteLinkOptions> options) : ControllerBase
{
    private readonly string _uploadPath = Path.GetFullPath(options.Value.UploadPath);

    [HttpGet]
    public IActionResult List()
    {
        var files = Directory.GetFiles(_uploadPath)
            .Select(f => new FileInfo(f))
            .Select(f => new { f.Name, Size = f.Length, Modified = f.LastWriteTimeUtc })
            .OrderByDescending(f => f.Modified);

        return Ok(files);
    }

    [HttpPost("upload")]
    [DisableRequestSizeLimit]
    [DisableFormValueModelBinding]
    public async Task<IActionResult> Upload(CancellationToken cancellationToken)
    {
        if (!MediaTypeHeaderValue.TryParse(Request.ContentType, out var contentType)
            || !contentType.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase))
            return BadRequest("Expected multipart/form-data");

        var boundary = HeaderUtilities.RemoveQuotes(contentType.Boundary).Value;
        if (string.IsNullOrEmpty(boundary))
            return BadRequest("Missing multipart boundary");

        var reader = new MultipartReader(boundary, Request.Body) { BodyLengthLimit = null };
        var uploaded = new List<string>();

        MultipartSection? section;
        while ((section = await reader.ReadNextSectionAsync(cancellationToken)) != null)
        {
            if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var cd)
                || !cd.DispositionType.Equals("form-data")
                || (StringSegment.IsNullOrEmpty(cd.FileName) && StringSegment.IsNullOrEmpty(cd.FileNameStar)))
                continue;

            var rawName = cd.FileNameStar.Value ?? cd.FileName.Value ?? string.Empty;
            var safeName = Path.GetFileName(rawName);
            if (string.IsNullOrEmpty(safeName)) continue;

            var dest = Path.Combine(_uploadPath, safeName);
            await using var fileStream = System.IO.File.Create(dest);
            await section.Body.CopyToAsync(fileStream, cancellationToken);
            uploaded.Add(safeName);
        }

        return Ok(new { uploaded });
    }

    [HttpGet("open-folder")]
    public IActionResult OpenFolder()
    {
        System.Diagnostics.Process.Start("explorer.exe", _uploadPath);
        return NoContent();
    }

    [HttpGet("download/{fileName}")]
    public IActionResult Download(string fileName)
    {
        var safeName = Path.GetFileName(fileName);
        var filePath = Path.Combine(_uploadPath, safeName);

        if (!System.IO.File.Exists(filePath))
            return NotFound();

        return PhysicalFile(filePath, "application/octet-stream", safeName);
    }

    [HttpDelete("{fileName}")]
    public IActionResult Delete(string fileName)
    {
        var safeName = Path.GetFileName(fileName);
        var filePath = Path.Combine(_uploadPath, safeName);

        if (!System.IO.File.Exists(filePath))
            return NotFound();

        try
        {
            System.IO.File.Delete(filePath);
            return NoContent();
        }
        catch (IOException)
        {
            return Conflict("File is in use by another process.");
        }
    }
}
